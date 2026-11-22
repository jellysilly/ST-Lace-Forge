/** Pulls a JSON value out of a chatty model reply, repairing the usual breakage. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  // Reasoning models sometimes leak their thinking before the answer.
  t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(t);
  if (fence && fence[1].trim()) t = fence[1].trim();
  const obj = t.indexOf('{');
  const arr = t.indexOf('[');
  const start = obj < 0 ? arr : arr < 0 ? obj : Math.min(obj, arr);
  if (start < 0) throw new JsonError('no-json');
  t = t.slice(start);
  const close = t[0] === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  const candidate = end > 0 ? t.slice(0, end + 1) : t;
  try {
    return JSON.parse(candidate);
  } catch {
    /* try repairs below */
  }
  for (const c of [candidate, t]) {
    try {
      return JSON.parse(repairJson(c));
    } catch {
      /* next */
    }
  }
  throw new JsonError('bad-json');
}

export class JsonError extends Error {}

/** Fixes raw newlines in strings, trailing commas and truncated output. */
export function repairJson(src: string) {
  let out = '';
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of src) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === '\n') {
        out += '\\n';
        continue;
      } else if (ch === '\r' || ch === '\t') {
        out += ch === '\t' ? '\\t' : '';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
    out += ch;
  }
  if (esc) out = out.slice(0, -1);
  if (inStr) out += '"';
  out = out.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/, '');
  // Drop a dangling key without a value, e.g. {"a":1,"b"
  out = out.replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/\{\s*"[^"]*"\s*:?\s*$/, '{');
  while (stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}

export const str = (v: unknown, fb = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fb);
export const strArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => str(x).trim()).filter(Boolean)
    : typeof v === 'string'
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
export const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : fb);
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
