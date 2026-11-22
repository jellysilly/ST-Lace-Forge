import { getState } from './store';
import { inST, stCtx } from './st';
import type { Connection, ProviderKind } from './types';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const DEFAULT_BASE: Record<ProviderKind, string> = {
  openai: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  st: '',
};

/** Quick-fill endpoints for OpenAI-compatible APIs. */
export const ENDPOINTS: { label: string; url: string }[] = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { label: 'xAI', url: 'https://api.x.ai/v1' },
  { label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { label: 'Ollama', url: 'http://localhost:11434/v1' },
  { label: 'KoboldCpp', url: 'http://localhost:5001/v1' },
];

const MSG = {
  ru: {
    network:
      'Не удалось достучаться до API. Проверьте адрес и интернет. У локальных серверов включите CORS (например, OLLAMA_ORIGINS=*); часть провайдеров не принимает запросы из браузера — тогда подойдут OpenRouter или прокси.',
    key: ' Проверьте API-ключ.',
    notFound: ' Проверьте название модели и адрес.',
    rate: ' Лимит запросов — подождите немного.',
    error: 'Ошибка',
    rejected: 'Модель отклонила запрос.',
    unreachable: 'Сервер недоступен из браузера (сеть или CORS).',
    noST: 'SillyTavern недоступна: откройте Кузницу из меню расширений SillyTavern или выберите другой тип API.',
    noProfile: 'Профиль подключения не найден — выберите другой в настройках API.',
    noCM: 'В этой версии SillyTavern нет Connection Manager — выберите «Текущее подключение».',
  },
  en: {
    network:
      "Couldn't reach the API. Check the address and your connection. Local servers need CORS enabled (e.g. OLLAMA_ORIGINS=*); some providers block browser requests — use OpenRouter or a proxy then.",
    key: ' Check the API key.',
    notFound: ' Check the model name and the address.',
    rate: ' Rate limit — wait a little.',
    error: 'Error',
    rejected: 'The model rejected the request.',
    unreachable: 'The server is unreachable from the browser (network or CORS).',
    noST: 'SillyTavern is not available: open the Forge from the SillyTavern extensions menu or pick another API type.',
    noProfile: 'Connection profile not found — pick another one in the API settings.',
    noCM: "This SillyTavern version has no Connection Manager — pick 'Current connection'.",
  },
};
const m = () => MSG[getState().lang] ?? MSG.ru;

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '');
const base = (conn: Connection) => trimSlash(conn.baseUrl) || DEFAULT_BASE[conn.provider];

export class LLMError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

export function isConfigured(conn: Connection) {
  if (conn.provider === 'st') return inST();
  if (!conn.model.trim()) return false;
  if (conn.provider === 'openai') return !!conn.baseUrl.trim();
  return !!conn.apiKey.trim();
}

interface Req {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Tweaks {
  noTemperature?: boolean;
  completionTokens?: boolean;
}

function buildRequest(conn: Connection, messages: ChatMsg[], stream: boolean, maxTokens: number, tw: Tweaks): Req {
  const system = messages.filter((x) => x.role === 'system').map((x) => x.content).join('\n\n');
  const chat = messages.filter((x) => x.role !== 'system');
  if (conn.provider === 'anthropic') {
    return {
      url: base(conn) + '/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': conn.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: conn.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: chat.map((x) => ({ role: x.role, content: x.content })),
        ...(tw.noTemperature ? {} : { temperature: Math.min(1, conn.temperature) }),
        stream,
      },
    };
  }
  if (conn.provider === 'gemini') {
    const model = conn.model.replace(/^models\//, '');
    const method = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    return {
      url: `${base(conn)}/models/${encodeURIComponent(model)}:${method}key=${encodeURIComponent(conn.apiKey.trim())}`,
      headers: { 'content-type': 'application/json' },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: chat.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...(tw.noTemperature ? {} : { temperature: conn.temperature }) },
      },
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (conn.apiKey.trim()) headers.authorization = 'Bearer ' + conn.apiKey.trim();
  return {
    url: base(conn) + '/chat/completions',
    headers,
    body: {
      model: conn.model,
      messages,
      ...(tw.completionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(tw.noTemperature ? {} : { temperature: conn.temperature }),
      stream,
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractDelta(kind: ProviderKind, data: any): string {
  if (kind === 'anthropic') {
    if (data?.type === 'error') throw new LLMError(data.error?.message ?? 'Anthropic error');
    return data?.type === 'content_block_delta' && data.delta?.type === 'text_delta' ? (data.delta.text ?? '') : '';
  }
  if (kind === 'gemini') {
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p: any) => !p.thought)
      .map((p: any) => p.text ?? '')
      .join('');
  }
  if (data?.error) throw new LLMError(data.error.message ?? String(data.error));
  return data?.choices?.[0]?.delta?.content ?? '';
}

function extractFull(kind: ProviderKind, data: any): string {
  if (kind === 'anthropic')
    return (data?.content ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
  if (kind === 'gemini') return extractDelta('gemini', data);
  return data?.choices?.[0]?.message?.content ?? '';
}

async function readError(res: Response) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    return (e?.message ?? j.message ?? text).toString();
  } catch {
    return text || res.statusText;
  }
}

export interface CompleteOpts {
  onDelta?: (chunk: string, full: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  /** Force a non-streaming request (connection tests). */
  noStream?: boolean;
}

export async function complete(conn: Connection, messages: ChatMsg[], opts: CompleteOpts = {}): Promise<string> {
  if (conn.provider === 'st') return stComplete(conn, messages, opts);
  const tweaks: Tweaks = {};
  const maxTokens = opts.maxTokens ?? conn.maxTokens;
  const stream = conn.stream && !opts.noStream;
  for (let attempt = 0; attempt < 3; attempt++) {
    const req = buildRequest(conn, messages, stream, maxTokens, tweaks);
    let res: Response;
    try {
      res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: opts.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new LLMError(m().network);
    }
    if (!res.ok) {
      const msg = await readError(res);
      // Some models reject parameters that others require; adapt and retry once per parameter.
      if (res.status === 400 && /temperature/i.test(msg) && !tweaks.noTemperature) {
        tweaks.noTemperature = true;
        continue;
      }
      if (res.status === 400 && /max_tokens|max_completion_tokens/i.test(msg) && !tweaks.completionTokens && conn.provider === 'openai') {
        tweaks.completionTokens = true;
        continue;
      }
      const hint = res.status === 401 || res.status === 403 ? m().key : res.status === 404 ? m().notFound : res.status === 429 ? m().rate : '';
      throw new LLMError(`${m().error} ${res.status}: ${msg}.${hint}`, res.status);
    }
    if (!stream || !res.body) {
      const data = await res.json();
      const text = extractFull(conn.provider, data);
      opts.onDelta?.(text, text);
      return text;
    }
    return readStream(conn.provider, res.body, opts.onDelta);
  }
  throw new LLMError(m().rejected);
}

async function readStream(kind: ProviderKind, body: ReadableStream<Uint8Array>, onDelta?: CompleteOpts['onDelta']) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      const chunk = extractDelta(kind, data);
      if (chunk) {
        full += chunk;
        onDelta?.(chunk, full);
      }
    }
  }
  return full;
}

export async function listModels(conn: Connection): Promise<string[]> {
  let url: string;
  const headers: Record<string, string> = {};
  if (conn.provider === 'anthropic') {
    url = base(conn) + '/models?limit=100';
    Object.assign(headers, { 'x-api-key': conn.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  } else if (conn.provider === 'gemini') {
    url = base(conn) + '/models?pageSize=200&key=' + encodeURIComponent(conn.apiKey.trim());
  } else {
    url = base(conn) + '/models';
    if (conn.apiKey.trim()) headers.authorization = 'Bearer ' + conn.apiKey.trim();
  }
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new LLMError(m().unreachable);
  }
  if (!res.ok) throw new LLMError(`${m().error} ${res.status}: ${await readError(res)}`, res.status);
  const data: any = await res.json();
  if (conn.provider === 'gemini') {
    return (data.models ?? [])
      .filter((x: any) => (x.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((x: any) => String(x.name).replace(/^models\//, ''));
  }
  return (data.data ?? data.models ?? []).map((x: any) => String(x.id ?? x.name)).sort();
}

/* ───────── SillyTavern as the provider ───────── */

export interface STProfile {
  id: string;
  name: string;
  /** 'cc' chat completion / 'tc' text completion, when ST says so. */
  mode?: string;
  api?: string;
  model?: string;
}

/** Connection Manager profiles saved in SillyTavern. */
export function stProfiles(): STProfile[] {
  const ctx = stCtx();
  const list = ctx?.extensionSettings?.connectionManager?.profiles;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p: any) => p && typeof p.id === 'string')
    .map((p: any) => ({ id: p.id, name: String(p.name ?? p.id), mode: p.mode, api: p.api, model: p.model }));
}

/** What the header badge shows for an ST connection. */
export function stLabel(conn: Connection): string {
  if (conn.stProfile) return stProfiles().find((p) => p.id === conn.stProfile)?.name ?? 'SillyTavern';
  const ctx = stCtx();
  let model = '';
  try {
    model = String(ctx?.getChatCompletionModel?.() || ctx?.onlineStatus || '');
  } catch {
    model = '';
  }
  return model && model !== 'no_connection' ? model : 'SillyTavern';
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => (signal.removeEventListener('abort', onAbort), resolve(v)),
      (e) => (signal.removeEventListener('abort', onAbort), reject(e)),
    );
  });
}

function stText(res: any): string {
  if (typeof res === 'string') return res;
  if (!res || typeof res !== 'object') return '';
  if (typeof res.content === 'string') return res.content;
  if (typeof res.text === 'string') return res.text;
  // Raw provider payload when ST did not extract the text.
  return extractFull('openai', res) || '';
}

async function stComplete(conn: Connection, messages: ChatMsg[], opts: CompleteOpts): Promise<string> {
  const ctx = stCtx();
  if (!ctx) throw new LLMError(m().noST);
  const maxTokens = opts.maxTokens ?? conn.maxTokens;
  let out: string;
  try {
    if (conn.stProfile) out = await stProfileComplete(ctx, conn, messages, maxTokens, opts);
    else out = await stMainComplete(ctx, messages, maxTokens, opts.signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof LLMError) throw e;
    throw new LLMError(`${m().error}: ${(e as Error)?.message || String(e)}`);
  }
  if (!out) return out;
  opts.onDelta?.(out, out);
  return out;
}

/** ST's current main connection, the same one the chat uses. */
async function stMainComplete(ctx: any, messages: ChatMsg[], maxTokens: number, signal?: AbortSignal) {
  if (typeof ctx.generateRaw !== 'function') throw new LLMError(m().noST);
  const system = messages.filter((x) => x.role === 'system').map((x) => x.content).join('\n\n');
  const chat = messages.filter((x) => x.role !== 'system');
  // Chat Completion takes a message list; text-completion APIs take a single prompt (ST adds instruct formatting).
  const params =
    ctx.mainApi === 'openai'
      ? { prompt: messages, responseLength: maxTokens }
      : { prompt: chat.map((x) => x.content).join('\n\n'), systemPrompt: system, responseLength: maxTokens };
  // generateRaw has no signal of its own but listens to ST's stop: use it so the request is really cancelled.
  const onAbort = () => {
    try {
      ctx.stopGeneration?.();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await abortable<unknown>(Promise.resolve(ctx.generateRaw(params)), signal);
    return stText(res);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** A Connection Manager profile: streams and aborts properly. */
async function stProfileComplete(ctx: any, conn: Connection, messages: ChatMsg[], maxTokens: number, opts: CompleteOpts) {
  const svc = ctx.ConnectionManagerRequestService;
  if (!svc?.sendRequest) throw new LLMError(m().noCM);
  if (!stProfiles().some((p) => p.id === conn.stProfile)) throw new LLMError(m().noProfile);
  const stream = conn.stream && !opts.noStream;
  const res = await svc.sendRequest(conn.stProfile, messages, maxTokens, { stream, signal: opts.signal ?? null, extractData: true, includePreset: true, includeInstruct: true });
  if (typeof res === 'function') {
    let full = '';
    for await (const chunk of res() as AsyncIterable<any>) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const text = typeof chunk === 'string' ? chunk : String(chunk?.text ?? '');
      if (text === full) continue;
      // ST yields the accumulated text; fall back to appending if a build yields deltas.
      full = text.startsWith(full) ? text : full + text;
      opts.onDelta?.(full, full);
    }
    return full;
  }
  return stText(res);
}
