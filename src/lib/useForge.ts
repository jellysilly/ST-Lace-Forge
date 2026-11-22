import { useCallback, useRef, useState } from 'react';
import { tNow } from '../i18n';
import { JsonError, extractJson } from './json';
import { complete, isConfigured, type ChatMsg } from './llm';
import { getState, setState } from './store';

export interface Forge<T> {
  busy: boolean;
  /** Streamed raw text. */
  text: string;
  error: string;
  result: T | null;
  run: (messages: ChatMsg[], parse: (json: unknown) => T | null, opts?: RunOpts<T>) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export interface RunOpts<T> {
  maxTokens?: number;
  /** Used when the reply has no JSON at all — single-text tasks can take the plain reply as is. */
  plain?: (text: string) => T | null;
}

/** Strips a stray fence or wrapping quotes from a plain-text reply. */
export const plainText = (s: string) =>
  s
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/^\s*```[a-z]*\n?|\n?```\s*$/gi, '')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();

/** One LLM request at a time: streams, parses JSON, keeps the parsed result for preview. */
export function useForge<T>(): Forge<T> {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<T | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async (messages: ChatMsg[], parse: (json: unknown) => T | null, opts: RunOpts<T> = {}) => {
    const t = tNow();
    const conn = getState().conn;
    setResult(null);
    setText('');
    if (!isConfigured(conn)) {
      setError(t.h.needApi);
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setError('');
    try {
      const out = await complete(conn, messages, { signal: c.signal, maxTokens: opts.maxTokens, onDelta: (_, full) => setText(full) });
      if (!out.trim()) throw new Error(t.h.empty);
      if (!getState().verified) setState({ verified: true });
      let parsed: T | null;
      try {
        parsed = parse(extractJson(out));
      } catch (e) {
        if (!(e instanceof JsonError)) throw e;
        const fallback = e.message === 'no-json' && opts.plain ? opts.plain(plainText(out)) : null;
        if (!fallback) throw new Error(e.message === 'no-json' ? t.h.noJson : t.h.badJson);
        parsed = fallback;
      }
      if (!parsed) throw new Error(t.h.nothing);
      setResult(parsed);
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? t.h.stopped : (e as Error).message);
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const clear = useCallback(() => {
    setResult(null);
    setText('');
    setError('');
  }, []);
  return { busy, text, error, result, run, stop, clear };
}
