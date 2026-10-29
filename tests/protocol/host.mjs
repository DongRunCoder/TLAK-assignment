import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function host(executable, args = [], options = {}) {
  const child = spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = [], backlog = [], waits = [];
  let text = '', stderr = '', failure;
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', error => { failure ??= error; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    text += chunk;
    for (let newline; (newline = text.indexOf('\n')) !== -1;) {
      const raw = text.slice(0, newline).replace(/\r$/, '');
      text = text.slice(newline + 1);
      try {
        const message = JSON.parse(raw);
        frames.push({ direction: 'executa-to-host', raw, message });
        const index = waits.findIndex(wait => wait.predicate(message));
        if (index === -1) backlog.push({ raw, message });
        else { const [wait] = waits.splice(index, 1); clearTimeout(wait.timer); wait.resolve({ raw, message }); }
      } catch (error) { failure = new Error(`stdout is not JSONL: ${raw}`, { cause: error }); }
    }
  });
  const closed = new Promise(resolve => {
    child.on('error', error => { failure = error; });
    child.on('close', (code, signal) => {
      for (const wait of waits.splice(0)) {
        clearTimeout(wait.timer);
        wait.reject(failure ?? new Error(`Executa exited (${code ?? signal}) before responding; stderr: ${stderr}`));
      }
      resolve({ code, signal });
    });
  });
  return {
    child, frames, closed,
    get stderr() { return stderr; },
    send(message) { this.sendRaw(JSON.stringify(message)); },
    sendRaw(raw) {
      let message;
      try { message = JSON.parse(raw); } catch { message = null; }
      frames.push({ direction: 'host-to-executa', raw, message });
      child.stdin.write(raw + '\n');
    },
    async receive(predicate, timeoutMs = 6000) {
      if (failure) throw failure;
      const index = backlog.findIndex(frame => predicate(frame.message));
      if (index !== -1) return backlog.splice(index, 1)[0];
      return new Promise((resolve, reject) => {
        const wait = { predicate, resolve, reject, timer: setTimeout(() => {
          waits.splice(waits.indexOf(wait), 1);
          reject(failure ?? new Error(`No matching protocol frame (${timeoutMs}ms); stderr: ${stderr}`));
        }, timeoutMs) };
        waits.push(wait);
      });
    },
    async save(path) {
      if (!path) return;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, frames.map(frame => JSON.stringify(frame)).join('\n') + '\n');
    },
    async stop() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2500);
      await closed;
      clearTimeout(timer);
      if (failure) throw failure;
      if (text) throw new Error(`Unterminated stdout JSON frame: ${text}`);
    }
  };
}

export function request(id, method, params = {}) { return { jsonrpc: '2.0', id, method, params }; }
