import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../i18n';
import { isConfigured, stLabel } from '../lib/llm';
import { setState, useStore } from '../lib/store';
import type { Forge } from '../lib/useForge';
import type { Lang } from '../lib/types';
import { Fld } from './ui';
import { Hammer, Stop } from './Icons';

interface Props<T> {
  sub: string;
  modes?: ReactNode;
  children: ReactNode;
  cta: string;
  /** Why the CTA can't run right now (shown instead of running). */
  blocked?: string;
  onForge: () => void;
  forge: Forge<T>;
  /** Preview of the parsed result. */
  preview?: (r: T) => ReactNode;
  onAccept: (r: T) => void;
}

export function Hearth<T>({ sub, modes, children, cta, blocked, onForge, forge, preview, onAccept }: Props<T>) {
  const t = useT();
  const conn = useStore((s) => s.conn);
  const outLang = useStore((s) => s.outLang);
  const hasGlobal = useStore((s) => !!s.globalInstr.trim());
  const ready = isConfigured(conn);
  const streamRef = useRef<HTMLPreElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Buttons in the editor start a run too; bring the result box into view so the run is visible.
  useEffect(() => {
    if (forge.busy) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [forge.busy]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [forge.text]);

  let host = '';
  try {
    host = conn.provider === 'st' ? 'SillyTavern' : new URL(conn.baseUrl).host;
  } catch {
    host = conn.provider;
  }
  const model = conn.provider === 'st' ? (conn.stProfile ? stLabel(conn) : '') : conn.model;

  const showBox = forge.busy || forge.error || forge.result;

  return (
    <aside className="hearth" aria-label={t.h.title}>
      <div className="hearth-top paper">
        <h2 className="serif">{t.h.title}</h2>
        <p>{sub}</p>
      </div>
      <div className="panel hearth-body">
        {modes}
        {children}
        <Fld label={t.h.outLang} htmlFor="out-lang">
          <select id="out-lang" className="field" value={outLang} onChange={(e) => setState({ outLang: e.target.value as Lang })}>
            <option value="ru">{t.h.outRu}</option>
            <option value="en">{t.h.outEn}</option>
          </select>
        </Fld>
        {hasGlobal && <p className="hint">{t.h.globalOn}</p>}
        {!ready && (
          <p className="note">
            {t.h.needApi} <a href="#/settings">{t.h.goApi}</a>
          </p>
        )}
        {blocked && ready && <p className="note plain">{blocked}</p>}
        {forge.busy ? (
          <button type="button" className="btn btn-ghost btn-big" onClick={forge.stop}>
            <Stop size={16} />
            {t.h.stop}
          </button>
        ) : (
          <button type="button" className="btn btn-fire btn-big" disabled={!ready || !!blocked} onClick={onForge}>
            <Hammer size={18} />
            {cta}
          </button>
        )}
        {showBox && (
          <div className="result" aria-live="polite" ref={boxRef}>
            {forge.busy && (
              <div className="row" style={{ color: 'var(--fire)', fontSize: 13, fontWeight: 600 }}>
                <span className="spin" />
                {forge.text ? t.h.writing : t.h.forging}
              </div>
            )}
            {forge.busy && forge.text && (
              <pre className="stream" ref={streamRef}>
                {forge.text}
              </pre>
            )}
            {forge.error && <p className="err">{forge.error}</p>}
            {forge.error && forge.text && !forge.busy && (
              <details>
                <summary>{t.h.showRaw}</summary>
                <pre className="stream">{forge.text}</pre>
              </details>
            )}
            {forge.result && (
              <>
                <span className="label">{t.h.result}</span>
                {preview?.(forge.result)}
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-fire"
                    onClick={() => {
                      onAccept(forge.result as T);
                      forge.clear();
                    }}
                  >
                    {t.h.accept}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={forge.clear}>
                    {t.h.discard}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {ready && (
          <span className="modelline">
            {model ? `${model} · ${host}` : host}
          </span>
        )}
      </div>
    </aside>
  );
}
