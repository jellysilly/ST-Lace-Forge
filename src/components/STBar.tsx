import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { inST } from '../lib/st';
import { stList, stLoadCharacter, stLoadLorebook, stLoadPersona, stLoadPreset, stPresetSelected, stSendCharacter, stSendLorebook, stSendPersona, stSendPreset, type STItem, type STKind } from '../lib/stio';
import { getState, patchItem, setState, upsert } from '../lib/store';
import type { CharacterDoc, LoreBook, PersonaDoc, PresetDoc } from '../lib/types';
import { fmt } from '../lib/util';
import { Download, Upload, X } from './Icons';
import { errText, toast } from './ui';

type Doc = PresetDoc | CharacterDoc | PersonaDoc | LoreBook;

const SEL = { presets: 'presetId', characters: 'charId', personas: 'personaId', lorebooks: 'bookId' } as const;

async function load(kind: STKind, id: string): Promise<Doc> {
  if (kind === 'presets') return stLoadPreset(id);
  if (kind === 'characters') return stLoadCharacter(id);
  if (kind === 'personas') return stLoadPersona(id);
  return stLoadLorebook(id);
}

async function send(kind: STKind, doc: Doc): Promise<string | null> {
  if (kind === 'presets') return stSendPreset(doc as PresetDoc);
  if (kind === 'characters') return stSendCharacter(doc as CharacterDoc);
  if (kind === 'personas') return stSendPersona(doc as PersonaDoc);
  return stSendLorebook(doc as LoreBook);
}

const docName = (d: Doc) => ('title' in d ? String(d.title) : d.name);

/** "From SillyTavern" / "To SillyTavern" buttons for a library page. Renders nothing outside ST. */
export function STBar({ kind, current, block }: { kind: STKind; current?: Doc; block?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!inST()) return null;
  const cls = block ? 'btn btn-ghost w100' : 'btn btn-ghost';

  const pick = async (item: STItem) => {
    setOpen(false);
    setBusy(true);
    try {
      const doc = await load(kind, item.id);
      upsert(kind, doc as never);
      setState({ [SEL[kind]]: doc.id } as never);
      toast(fmt(t.st.loaded, { what: docName(doc) || item.name }));
    } catch (e) {
      toast(fmt(t.st.loadFail, { name: item.name, why: errText(e) }), true);
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const link = await send(kind, current);
      if (link === null) return;
      const field = kind === 'characters' || kind === 'personas' ? 'stAvatar' : 'stName';
      // The library item may have changed while the request ran; patch the live one.
      if ((getState()[kind] as Doc[]).some((x) => x.id === current.id)) patchItem(kind, current.id, ((x: Doc) => ({ ...x, [field]: link })) as never);
      const shown = kind === 'presets' || kind === 'lorebooks' ? link : docName(current);
      toast(fmt(t.st.sent, { name: shown }));
      if (kind === 'presets' && stPresetSelected(link)) toast(fmt(t.st.reloaded, { name: link }));
    } catch (e) {
      toast(fmt(t.st.sendFail, { why: errText(e) }), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)} disabled={busy} title={t.st.fromHint}>
        <Download size={16} />
        {t.st.from}
      </button>
      {current && (
        <button type="button" className={cls} onClick={push} disabled={busy} title={t.st.toHint}>
          {busy ? <span className="spin" /> : <Upload size={16} />}
          {t.st.to}
        </button>
      )}
      {open && <STPicker kind={kind} onPick={pick} onClose={() => setOpen(false)} />}
    </>
  );
}

function STPicker({ kind, onPick, onClose }: { kind: STKind; onPick: (i: STItem) => void; onClose: () => void }) {
  const t = useT();
  const [items, setItems] = useState<STItem[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    stList(kind).then(
      (list) => live && setItems(list),
      (e) => live && setError(fmt(t.st.listFail, { why: errText(e) })),
    );
    return () => {
      live = false;
    };
  }, [kind, t]);

  useEffect(() => {
    // No autofocus on touch screens: the keyboard would cover half the list.
    if (window.matchMedia?.('(pointer: fine)').matches) searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !needle || i.name.toLowerCase().includes(needle));
  }, [items, q]);

  const title = t.st.pick[kind];
  return (
    <div className="stpick-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stpick panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="stpick-head">
          <h2 className="serif">{title}</h2>
          <button type="button" className="iconbtn lg" onClick={onClose} aria-label={t.st.cancel} title={t.st.cancel}>
            <X size={18} />
          </button>
        </div>
        {items && items.length > 6 && <input ref={searchRef} className="field" type="search" placeholder={t.st.search} aria-label={t.st.search} value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="stpick-list">
          {error ? (
            <p className="note">{error}</p>
          ) : !items ? (
            <p className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="spin" />
              {t.st.loading}
            </p>
          ) : shown.length === 0 ? (
            <p className="hint">{items.length ? t.st.nothingFound : t.st.empty}</p>
          ) : (
            shown.map((i) => (
              <button key={i.id} type="button" className="stpick-item" onClick={() => onPick(i)}>
                {i.img !== undefined && (kind === 'characters' || kind === 'personas') && <img src={i.img} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />}
                <span>{i.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
