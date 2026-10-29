package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type testHost struct {
	input  *io.PipeWriter
	output *io.PipeReader
	reader *bufio.Reader
	done   chan struct{}
}

func newTestHost(t *testing.T, config serverConfig) *testHost {
	t.Helper()
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()
	h := &testHost{input: inWriter, output: outReader, reader: bufio.NewReader(outReader), done: make(chan struct{})}
	go func() {
		runServer(context.Background(), inReader, outWriter, io.Discard, config)
		outWriter.Close()
		close(h.done)
	}()
	t.Cleanup(func() {
		inWriter.Close()
		outReader.Close()
		select {
		case <-h.done:
		case <-time.After(3 * time.Second):
			t.Error("server did not finish within shutdown budget")
		}
	})
	return h
}
func (h *testHost) send(t *testing.T, raw string) {
	t.Helper()
	if _, err := io.WriteString(h.input, raw+"\n"); err != nil {
		t.Fatal(err)
	}
}
func (h *testHost) receive(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	type frame struct {
		bytes []byte
		err   error
	}
	read := make(chan frame, 1)
	go func() { value, err := h.reader.ReadBytes('\n'); read <- frame{value, err} }()
	select {
	case line := <-read:
		if line.err != nil {
			t.Fatalf("read frame: %v", line.err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(line.bytes, &fields); err != nil {
			t.Fatalf("invalid stdout: %v", err)
		}
		return fields
	case <-time.After(2 * time.Second):
		t.Fatal("frame deadline exceeded")
		return nil
	}
}
func invocation(id, invokeID string) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"method":"invoke","params":{"tool":"summarize","arguments":{"notes":["note"]},"context":{"invoke_id":%q}}}`, id, invokeID)
}
func result(t *testing.T, frame map[string]json.RawMessage) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(frame["result"], &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestEOFCompletesQuickRequests(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, `{"jsonrpc":"2.0","id":9007199254740993,"method":"describe"}`)
	h.input.Close()
	frame := h.receive(t)
	if string(frame["id"]) != "9007199254740993" {
		t.Fatal("large numeric ID was changed")
	}
	if result(t, frame)["name"] != "mini-notes-summarizer" {
		t.Fatal("describe is not bare manifest")
	}
	select {
	case <-h.done:
	case <-time.After(3 * time.Second):
		t.Fatal("EOF did not exit")
	}
}

func TestEOFAndShutdownCancelPendingWithOpenStdin(t *testing.T) {
	for _, shutdown := range []bool{false, true} {
		t.Run(fmt.Sprint(shutdown), func(t *testing.T) {
			h := newTestHost(t, serverConfig{})
			h.send(t, invocation(`"waiting"`, "eof-invoke"))
			h.receive(t)
			if shutdown {
				h.send(t, `{"jsonrpc":"2.0","id":"stop","method":"shutdown"}`)
				h.receive(t)
			} else {
				h.input.Close()
			}
			completed := result(t, h.receive(t))
			if completed["success"] != false || !strings.HasPrefix(completed["error"].(string), "SAMPLING_CANCELLED:") {
				t.Fatalf("pending did not cancel: %v", completed)
			}
			select {
			case <-h.done:
			case <-time.After(3 * time.Second):
				t.Fatal("server waited on stdin after stop")
			}
		})
	}
}

func TestTimeoutReleasesSlotAndIgnoresLateResponses(t *testing.T) {
	h := newTestHost(t, serverConfig{SamplingTimeout: 20 * time.Millisecond})
	h.send(t, invocation(`1`, "first"))
	reverse := h.receive(t)
	if got := result(t, h.receive(t))["error"].(string); !strings.HasPrefix(got, "SAMPLING_TIMEOUT:") {
		t.Fatal(got)
	}
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"late"}}}`, reverse["id"]))
	h.send(t, invocation(`2`, "second"))
	next := h.receive(t)
	if string(next["method"]) != `"sampling/createMessage"` {
		t.Fatalf("slot not released: %s", next)
	}
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"second response"}}}`, next["id"]))
	if result(t, h.receive(t))["success"] != true {
		t.Fatal("second request did not succeed")
	}
}

func TestReverseStringIDUsesDecodedJSONIdentity(t *testing.T) {
	h := newTestHost(t, serverConfig{SamplingTimeout: 40 * time.Millisecond})
	h.send(t, invocation(`1`, "escaped-id"))
	reverse := h.receive(t)
	escapedID := strings.Replace(string(reverse["id"]), "sampling", `\u0073ampling`, 1)
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"matching escaped ID"}}}`, escapedID))
	if got := result(t, h.receive(t)); got["success"] != true {
		t.Fatalf("equivalent JSON string ID did not match: %v", got)
	}
}

func TestIndependentRunnerInvokesWithoutContextGetDistinctCorrelationIDs(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, `{"jsonrpc":"2.0","id":"initialize","method":"initialize","params":{"protocolVersion":"2.0","capabilities":{"sampling":{}}}}`)
	if result(t, h.receive(t))["protocolVersion"] != "2.0" {
		t.Fatal("did not negotiate v2")
	}
	previous := ""
	for i := 0; i < 2; i++ {
		// Reusing the request ID proves that invoke correlation is independent
		// of JSON-RPC transport identity, as required by the standalone runner.
		h.send(t, `{"jsonrpc":"2.0","id":"same-request-id","method":"invoke","params":{"tool":"summarize","arguments":{"notes":["runner note"]}}}`)
		reverse := h.receive(t)
		if string(reverse["method"]) != `"sampling/createMessage"` {
			t.Fatalf("runner invoke did not request sampling: %s", reverse)
		}
		var params struct {
			Context struct {
				InvokeID string `json:"invoke_id"`
			} `json:"context"`
			Metadata struct {
				InvokeID string `json:"executa_invoke_id"`
			} `json:"metadata"`
		}
		if err := json.Unmarshal(reverse["params"], &params); err != nil {
			t.Fatal(err)
		}
		correlation := params.Context.InvokeID
		if correlation == "" || correlation == "same-request-id" || correlation == previous || correlation != params.Metadata.InvokeID {
			t.Fatalf("invalid per-invoke correlation: context=%q metadata=%q previous=%q", correlation, params.Metadata.InvokeID, previous)
		}
		previous = correlation
		h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"exact host summary"}}}`, reverse["id"]))
		completed := result(t, h.receive(t))
		if completed["success"] != true || completed["data"].(map[string]any)["summary"] != "exact host summary" {
			t.Fatalf("runner invoke did not return host summary: %v", completed)
		}
	}
}

func TestHostInvokeCorrelationIsPreserved(t *testing.T) {
	for name, extra := range map[string]string{
		"context takes precedence": `,"context":{"invoke_id":" host supplied "},"invoke_id":"fallback"`,
		"top level":                `,"invoke_id":" host supplied "`,
	} {
		t.Run(name, func(t *testing.T) {
			h := newTestHost(t, serverConfig{})
			h.send(t, `{"jsonrpc":"2.0","id":1,"method":"invoke","params":{"tool":"summarize","arguments":{"notes":["note"]}`+extra+`}}`)
			reverse := h.receive(t)
			var params struct {
				Context struct {
					InvokeID string `json:"invoke_id"`
				} `json:"context"`
				Metadata struct {
					InvokeID string `json:"executa_invoke_id"`
				} `json:"metadata"`
			}
			if err := json.Unmarshal(reverse["params"], &params); err != nil {
				t.Fatal(err)
			}
			if params.Context.InvokeID != " host supplied " || params.Metadata.InvokeID != " host supplied " {
				t.Fatalf("host correlation changed: %s", reverse["params"])
			}
		})
	}
}

func TestInvalidUnicodeSamplingResponseIsNotSilentlyChanged(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, invocation(`1`, "bad-unicode"))
	reverse := h.receive(t)
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"\ud800"}}}`, reverse["id"]))
	if got := result(t, h.receive(t)); got["success"] != false {
		t.Fatalf("silently substituted invalid Unicode: %v", got)
	}
}

func TestInitializeIsSynchronousAndV1CannotSample(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0"}}`)
	if result(t, h.receive(t))["protocolVersion"] != "1.0" {
		t.Fatal("did not negotiate v1 honestly")
	}
	h.send(t, invocation(`2`, "v1"))
	if got := result(t, h.receive(t))["error"].(string); !strings.HasPrefix(got, "SAMPLING_UNAVAILABLE:") {
		t.Fatal(got)
	}
}

type failedWriter struct {
	once      sync.Once
	attempted chan struct{}
}

func (w *failedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.attempted) })
	return 0, io.ErrClosedPipe
}
func TestWriterFailureExitsWhileStdinRemainsOpen(t *testing.T) {
	inReader, inWriter := io.Pipe()
	defer inWriter.Close()
	w := &failedWriter{attempted: make(chan struct{})}
	done := make(chan struct{})
	go func() { runServer(context.Background(), inReader, w, io.Discard, serverConfig{}); close(done) }()
	io.WriteString(inWriter, `{"jsonrpc":"2.0","id":1,"method":"describe"}`+"\n")
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("write failure left reader blocking shutdown")
	}
}

func TestOversizedLineIsDrainedAndNextRequestWorks(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, strings.Repeat("x", maxFrameBytes+1))
	var errorValue rpcError
	json.Unmarshal(h.receive(t)["error"], &errorValue)
	if errorValue.Code != -32600 {
		t.Fatalf("wrong oversize error: %+v", errorValue)
	}
	h.send(t, `{"jsonrpc":"2.0","id":1,"method":"health"}`)
	if result(t, h.receive(t))["status"] != "ready" {
		t.Fatal("reader did not recover")
	}
}

func TestPastHostDeadlineIsTimeoutWithoutReverseRequest(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"invoke","params":{"tool":"summarize","arguments":{"notes":["note"]},"context":{"invoke_id":"deadline","deadline":%q}}}`, time.Now().Add(-time.Second).Format(time.RFC3339Nano)))
	if got := result(t, h.receive(t))["error"].(string); !strings.HasPrefix(got, "SAMPLING_TIMEOUT:") {
		t.Fatalf("expired host deadline misreported: %s", got)
	}
}

func TestScalarParamsAreInvalidJSONRPCRequest(t *testing.T) {
	h := newTestHost(t, serverConfig{})
	h.send(t, `{"jsonrpc":"2.0","id":1,"method":"health","params":false}`)
	frame := h.receive(t)
	var got rpcError
	if json.Unmarshal(frame["error"], &got) != nil || got.Code != -32600 {
		t.Fatalf("accepted non-structured params: %s", frame)
	}
}

func TestObjectsWithoutRequestOrResponseFieldsAreInvalidRequests(t *testing.T) {
	for _, raw := range []string{`{}`, `{"jsonrpc":"2.0"}`, `{"jsonrpc":"2.0","id":"missing-method"}`} {
		t.Run(raw, func(t *testing.T) {
			h := newTestHost(t, serverConfig{})
			h.send(t, raw)
			frame := h.receive(t)
			var got rpcError
			if json.Unmarshal(frame["error"], &got) != nil || got.Code != -32600 || string(frame["id"]) != "null" {
				t.Fatalf("invalid object did not receive Invalid Request: %s", frame)
			}
		})
	}
}

func TestOfficialTopLevelDeadlineBoundsSampling(t *testing.T) {
	for _, extra := range []string{
		fmt.Sprintf(`"deadline_ms":%d`, time.Now().Add(-time.Second).UnixMilli()),
	} {
		t.Run(extra, func(t *testing.T) {
			h := newTestHost(t, serverConfig{})
			started := time.Now()
			h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"invoke","params":{"tool":"summarize","arguments":{"notes":["note"]},"context":{"invoke_id":"official-deadline"},%s}}`, extra))
			frame := h.receive(t)
			if frame["method"] != nil {
				frame = h.receive(t)
			}
			if got := result(t, frame)["error"].(string); !strings.HasPrefix(got, "SAMPLING_TIMEOUT:") {
				t.Fatalf("did not honor official invoke deadline: %s", got)
			}
			if time.Since(started) > time.Second {
				t.Fatal("short host budget was not honored")
			}
		})
	}
}

// The host can receive a full response before the OS writer returns. Holding
// that final Write open makes the post-response slot race reproducible.
type heldResultWriter struct {
	writer  io.Writer
	release chan struct{}
	once    sync.Once
}

func (w *heldResultWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	if bytes.Contains(data, []byte(`"success":true`)) {
		w.once.Do(func() { <-w.release })
	}
	return n, err
}
func TestCompletedResultReleasesSlotBeforeNextInvoke(t *testing.T) {
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()
	writer := &heldResultWriter{writer: outWriter, release: make(chan struct{})}
	h := &testHost{input: inWriter, output: outReader, reader: bufio.NewReader(outReader), done: make(chan struct{})}
	go func() {
		runServer(context.Background(), inReader, writer, io.Discard, serverConfig{})
		outWriter.Close()
		close(h.done)
	}()
	t.Cleanup(func() {
		inWriter.Close()
		outReader.Close()
		select {
		case <-h.done:
		case <-time.After(3 * time.Second):
			t.Error("server did not stop")
		}
	})
	h.send(t, invocation(`1`, "first"))
	reverse := h.receive(t)
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"first done"}}}`, reverse["id"]))
	if result(t, h.receive(t))["success"] != true {
		t.Fatal("first request failed")
	}
	h.send(t, invocation(`2`, "second"))
	time.Sleep(20 * time.Millisecond)
	close(writer.release)
	next := h.receive(t)
	if string(next["method"]) != `"sampling/createMessage"` {
		t.Fatalf("completed invoke still occupied active slot: %s", next)
	}
	h.send(t, invocation(`3`, "must-still-be-busy"))
	if got := result(t, h.receive(t))["error"].(string); !strings.HasPrefix(got, "TOOL_BUSY:") {
		t.Fatalf("old cleanup cleared new owner: %s", got)
	}
	h.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"content":{"type":"text","text":"second done"}}}`, next["id"]))
	if result(t, h.receive(t))["success"] != true {
		t.Fatal("second request failed")
	}
}
