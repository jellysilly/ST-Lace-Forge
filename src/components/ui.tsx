import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { tNow, useT } from '../i18n';
import { getState, onStorageError, setState, useStore } from '../lib/store';
import { fmt, tokens } from '../lib/util';
import { Regen, X } from './Icons';

/* ───────── toasts ───────── */

interface ToastItem {
  id: number;
  text: string;
  bad: boolean;
}
let toasts: ToastItem[] = [];
const toastSubs = new Set<() => void>();
let toastSeq = 0;

export function toast(text: string, bad = false) {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-3), { id, text, bad }];
  toastSubs.forEach((f) => f());
  setTimeout(() => dismiss(id), bad ? 9000 : 4000);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  toastSubs.forEach((f) => f());
}

export function Toasts() {
  const list = useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toasts,
  );
  useEffect(() => {
    const off = onStorageError((failed) => failed && toast(tNow().c.storageFail, true));
    return () => {
      off();
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={t.bad ? 'toast bad' : 'toast'}>
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="×">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Localised reason for an import failure. */
export function errText(e: unknown) {
  const t = tNow();
  const msg = e instanceof Error ? e.message : String(e);
  return t.c.err[msg] ?? (msg || t.c.err.unknown);
}

export function importFailed(name: string, e: unknown) {
  toast(fmt(tNow().c.importFailed, { name, why: errText(e) }), true);
}

export function confirmDelete(name: string) {
  return window.confirm(fmt(tNow().c.confirmDelete, { name: name || tNow().c.untitled }));
}

/* ───────── controls ───────── */

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className={on ? 'sw on' : 'sw'} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} title={label}>
      <span className="track">
        <span className="knob" />
      </span>
    </button>
  );
}

/** NSFW 18+ mode for story writing (plots, greetings from a plot). Asks for age confirmation once per browser. */
export function NsfwSwitch() {
  const t = useT();
  const nsfw = useStore((s) => s.nsfw);
  const toggle = () => {
    if (nsfw) return setState({ nsfw: false });
    if (!getState().adultOk && !window.confirm(t.pl.adultConfirm)) return;
    setState({ nsfw: true, adultOk: true });
  };
  return (
    <button type="button" className={nsfw ? 'nsfw on' : 'nsfw'} aria-pressed={nsfw} onClick={toggle} title={nsfw ? t.pl.nsfwOn : t.pl.nsfwOff}>
      <span className="track">
        <span className="knob" />
      </span>
      {t.pl.nsfw}
    </button>
  );
}

export function Modes<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="modes">
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'mode on' : 'mode'} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StylePicker<T extends string>({
  label,
  value,
  ids,
  names,
  onChange,
}: {
  label: string;
  value: T;
  ids: readonly T[];
  names: Record<T, { name: string; desc: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="fld" role="group" aria-label={label}>
      <span className="label">{label}</span>
      {ids.map((id) => (
        <button key={id} type="button" className={value === id ? 'opt on' : 'opt'} aria-pressed={value === id} onClick={() => onChange(id)}>
          <span className="serif">{names[id].name}</span>
          <small>{names[id].desc}</small>
        </button>
      ))}
    </div>
  );
}

export function Fld({ label, htmlFor, extra, children, className }: { label: ReactNode; htmlFor?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={'fld' + (className ? ' ' + className : '')}>
      <div className="fld-head">
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
        {extra && <div className="meta">{extra}</div>}
      </div>
      {children}
    </div>
  );
}

export function Tok({ text }: { text: string }) {
  const t = tNow();
  return (
    <span className="tokn">
      ~{tokens(text)} {t.c.tok}
    </span>
  );
}

/** Text field with a token counter and an optional ↻ button that reforges just this field. */
export function TextFld({ id, label, value, rows, onChange, hot, onTarget, regenLabel }: { id: string; label: string; value: string; rows: number; onChange: (v: string) => void; hot?: boolean; onTarget?: () => void; regenLabel: string }) {
  return (
    <Fld
      label={label}
      htmlFor={id}
      extra={
        <>
          <Tok text={value} />
          {onTarget && (
            <button type="button" className={hot ? 'iconbtn hot' : 'iconbtn'} onClick={onTarget} aria-label={`${regenLabel}: ${label}`} aria-pressed={!!hot} title={regenLabel}>
              <Regen size={16} />
            </button>
          )}
        </>
      }
    >
      <textarea id={id} className={hot ? 'field hot' : 'field'} rows={rows} style={{ fontSize: 14 }} value={value} onChange={(e) => onChange(e.target.value)} />
    </Fld>
  );
}

/** Number input that keeps its own text while typing and commits valid numbers. */
export function NumInput({ value, onChange, min, max, id, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; id?: string; step?: number }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  return (
    <input
      id={id}
      className="field"
      type="number"
      inputMode="numeric"
      value={txt}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
      }}
      onBlur={() => setTxt(String(value))}
    />
  );
}

/** Chips with an inline input; Enter or comma adds, Backspace on empty removes the last. */
export function KeyBox({ keys, onChange, secondary, placeholder, removeLabel, label }: { keys: string[]; onChange: (k: string[]) => void; secondary?: boolean; placeholder: string; removeLabel: string; label: string }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !keys.includes(s));
    if (parts.length) onChange([...keys, ...parts]);
    setDraft('');
  };
  return (
    <div className={secondary ? 'keybox sec' : 'keybox'}>
      {keys.map((k, i) => (
        <span key={k + i} className={secondary ? 'key sec' : 'key'}>
          {k}
          <button type="button" className="keyx" aria-label={`${removeLabel}: ${k}`} onClick={() => onChange(keys.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          if (e.target.value.includes(',')) add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && keys.length) onChange(keys.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

export function PageHead({ kicker, title, children, sub }: { kicker: string; title: string; children?: ReactNode; sub?: string }) {
  return (
    <div className="pagehead">
      <div>
        <span className="kicker">{kicker}</span>
        <h1 className="serif">{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
