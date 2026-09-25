// Structured JSON logger with secret redaction. Never pass private keys; redaction is a safety net.
// Field names whose values are never logged: keys, secrets, claim codes, auth tokens/sessions and signatures
// (a signature can be replayable before it is used). Tx hashes stay visible.
const SECRET_KEY = /^(.*private.*|.*secret.*|.*api_?key.*|password|code|mnemonic|seed|authorization|cookie|key|.*(auth|access|session|refresh|bearer|api)_?token.*|session|sig|signature|bearer)$/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return { name: v.name, message: redact(v.message, depth + 1) };
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(x, depth + 1);
    return out;
  }
  return v;
}

export function makeLogger(service: string) {
  const emit = (level: string, msg: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, msg, ...(redact(fields) as object) });
    (level === "error" ? process.stderr : process.stdout).write(line + "\n");
  };
  return {
    info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
    warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
    error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
  };
}
export type Logger = ReturnType<typeof makeLogger>;
