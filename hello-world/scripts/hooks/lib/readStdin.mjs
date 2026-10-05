// Reads a hook's JSON payload from stdin. Claude Code closes stdin after writing it; the TTY guard and
// the timeout exist so a manual run (or a missing close) can never hang the hook - on either, the
// text read so far (possibly "") is returned and the caller treats it as unusable input.
export function readStdin({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    process.stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}
