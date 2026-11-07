// Bounded, serial JSON-lines proof dispatcher. Luke Steuber.
// The parent enforces a deadline (including synchronous engine loops) by killing
// this process. No game code or browser-supplied module paths are evaluated here.
import { pathToFileURL } from 'node:url';

const MAX_LINE = 65536;
const MAX_VALUE = Number.MAX_SAFE_INTEGER;
const moduleURL = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('../adapters/validators.mjs', import.meta.url).href;
let modulePromise;

async function dispatch(request) {
  const id = request?.id;
  if (!Number.isSafeInteger(id) || !request.identity ||
      typeof request.identity !== 'object' || !request.proof ||
      typeof request.proof !== 'object') return { id, valid: false };
  let adapter;
  try {
    modulePromise ??= import(moduleURL);
    adapter = await modulePromise;
  } catch {
    return { id, valid: false, unavailable: true };
  }
  if (typeof adapter.validateProof !== 'function') {
    return { id, valid: false, unavailable: true };
  }
  try {
    const result = await adapter.validateProof({
      identity: request.identity, proof: request.proof,
      elapsedMs: request.elapsedMs, startedAt: request.startedAt,
      assisted: request.assisted, repeat: request.repeat,
      practice: request.practice,
    });
    if (!result || result.valid !== true ||
        !Number.isSafeInteger(result.value) || result.value < 0 ||
        result.value > MAX_VALUE ||
        ['assisted', 'repeat', 'practice'].some(key =>
          key in result && typeof result[key] !== 'boolean')) {
      return { id, valid: false };
    }
    // Project a fixed response: adapter diagnostics/proof never reach the API.
    return { id, valid: true, value: result.value,
      assisted: result.assisted === true, repeat: result.repeat === true,
      practice: result.practice === true };
  } catch {
    return { id, valid: false };
  }
}

// Pause input while validating; never accumulate an unbounded promise queue.
let pending = Buffer.alloc(0);
let busy = false;
function fail() { process.exit(1); }
async function drain() {
  if (busy) return;
  busy = true;
  process.stdin.pause();
  try {
    for (;;) {
      const newline = pending.indexOf(10);
      if (newline < 0) break;
      if (newline > MAX_LINE) return fail();
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      let request;
      try { request = JSON.parse(line.toString('utf8')); }
      catch { return fail(); }
      const answer = JSON.stringify(await dispatch(request)) + '\n';
      if (!process.stdout.write(answer)) {
        await new Promise(resolve => process.stdout.once('drain', resolve));
      }
    }
    if (pending.length > MAX_LINE) return fail();
  } finally {
    busy = false;
    process.stdin.resume();
  }
}
process.stdin.on('data', chunk => {
  if (pending.length + chunk.length > MAX_LINE * 2) return fail();
  pending = Buffer.concat([pending, chunk]);
  void drain();
});
process.stdin.on('end', () => { if (pending.length) fail(); });
process.stdin.on('error', fail);
process.stdout.on('error', fail);
