package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNotesUseJavaScriptWhitespaceAndKeepOriginalText(t *testing.T) {
	for _, whitespace := range []string{" ", "\n\t", "\u00a0", "\ufeff", "\u2028\u2029"} {
		encoded, _ := json.Marshal([]string{whitespace})
		if _, err := validateNotes(encoded); err == nil {
			t.Errorf("accepted JS whitespace %q", whitespace)
		}
	}
	for _, content := range []string{"\u0085", "\u180e", "  hello\n", "😀"} {
		encoded, _ := json.Marshal([]string{content})
		notes, err := validateNotes(encoded)
		if err != nil || notes[0] != content {
			t.Errorf("did not preserve valid note %q: %v", content, err)
		}
	}
}

func TestNotesCapacityAndUnicode(t *testing.T) {
	for name, raw := range map[string]string{
		"empty": `[]`, "missing": `null`, "wrong item": `[123]`,
		"unpaired high": `["\ud800"]`, "unpaired low": `["\udfff"]`,
		"high followed by text": `["\ud800x"]`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateNotes([]byte(raw)); err == nil {
				t.Fatal("accepted invalid notes")
			}
		})
	}
	for _, count := range []int{1000, 1001} {
		raw, _ := json.Marshal([]string{strings.Repeat("😀", count)})
		_, err := validateNotes(raw)
		if (err == nil) != (count == 1000) {
			t.Errorf("code point boundary %d: %v", count, err)
		}
	}
	for _, count := range []int{100, 101} {
		notes := make([]string, count)
		for i := range notes {
			notes[i] = "a"
		}
		raw, _ := json.Marshal(notes)
		_, err := validateNotes(raw)
		if (err == nil) != (count == 100) {
			t.Errorf("count boundary %d: %v", count, err)
		}
	}
	for _, total := range []int{24576, 24577} {
		var notes []string
		for remaining := total; remaining > 0; {
			size := min(remaining, 1000)
			notes = append(notes, strings.Repeat("a", size))
			remaining -= size
		}
		raw, _ := json.Marshal(notes)
		_, err := validateNotes(raw)
		if (err == nil) != (total == 24576) {
			t.Errorf("byte boundary %d: %v", total, err)
		}
	}
}
