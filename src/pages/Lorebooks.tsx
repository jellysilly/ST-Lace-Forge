import { useEffect, useState } from 'react';
import { Hearth } from '../components/Hearth';
import { Download, Key, Plus, Regen, Trash, Upload } from '../components/Icons';
import { Fld, KeyBox, Modes, NumInput, PageHead, StylePicker, Tok, confirmDelete, importFailed, toast } from '../components/ui';
import { STBar } from '../components/STBar';
import { useT } from '../i18n';
import { isObj, str, strArr } from '../lib/json';
import { POSITIONS, emptyBook, importLorebook, newEntry, toSTWorld } from '../lib/lorebook';
import { loreAdd, loreKeys, loreRegen, loreWorld, type Common } from '../lib/prompts';
import { LORE_STYLES, type LoreStyle } from '../lib/styles';
import { getState, patchItem, removeItem, setState, upsert, useStore } from '../lib/store';
import type { LoreBook, LoreEntry, LoreLogic } from '../lib/types';
import { useForge } from '../lib/useForge';
import { download, fmt, pickFile, plural, slugify } from '../lib/util';

type Mode = 'world' | 'add' | 'regen';
type Res =
  | { kind: 'entries'; bookId: string; name?: string; entries: LoreEntry[] }
  | { kind: 'regen'; bookId: string; id: string; patch: Partial<LoreEntry> }
  | { kind: 'keys'; bookId: string; id: string; keys: string[]; secondary: string[] };

export function Lorebooks() {
  const t = useT();
  const l = t.l;
  const books = useStore((s) => s.lorebooks);
  const bookId = useStore((s) => s.bookId);
  const book = books.find((b) => b.id === bookId) ?? books[0];

  const createNew = () => {
    const b = emptyBook(l.newBookName);
    upsert('lorebooks', b);
    setState({ bookId: b.id });
  };

  const doImport = async () => {
    const files = await pickFile('.json,application/json', true);
    let last = '';
    for (const f of files) {
      try {
        const b = importLorebook(await f.text(), f.name);
        upsert('lorebooks', b);
        last = b.id;
        toast(fmt(t.c.imported, { what: `${b.name} (${b.entries.length})` }));
      } catch (e) {
        importFailed(f.name, e);
      }
    }
    if (last) setState({ bookId: last });
  };

  return (
    <div className="page">
      <PageHead kicker={l.kicker} title={l.title}>
        <button type="button" className="btn btn-ghost" onClick={doImport}>
          <Download size={16} />
          {l.import}
        </button>
        {book && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const name = `${slugify(book.name, 'lorebook')}.json`;
              download(name, JSON.stringify(toSTWorld(book), null, 2));
              toast(fmt(t.c.exported, { name }));
            }}
          >
            <Upload size={16} />
            {t.c.export}
          </button>
        )}
        <STBar kind="lorebooks" current={book} />
        <button type="button" className="btn btn-ghost" onClick={createNew}>
          <Plus size={16} />
          {l.newBook}
        </button>
      </PageHead>
      {book ? (
        <Workspace key={book.id} book={book} books={books} />
      ) : (
        <section className="panel empty">
          <h2 className="serif">{l.emptyTitle}</h2>
          <p>{l.emptyText}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-fire" onClick={createNew}>
              <Plus size={16} />
              {l.newBook}
            </button>
            <button type="button" className="btn btn-ghost" onClick={doImport}>
              <Download size={16} />
              {l.import}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function parseEntry(x: unknown, autoKeys: boolean): LoreEntry | null {
  if (!isObj(x)) return null;
  const title = str(x.title ?? x.name ?? x.comment).trim();
  const content = str(x.content).trim();
  if (!content) return null;
  const keys = autoKeys ? strArr(x.keys ?? x.key) : [];
  return newEntry({
    title,
    content,
    keys: keys.length ? keys : title ? [title] : [],
    secondary: autoKeys ? strArr(x.secondary ?? x.secondary_keys) : [],
    constant: x.constant === true,
    order: x.constant === true ? 10 : 100,
  });
}

function Workspace({ book, books }: { book: LoreBook; books: LoreBook[] }) {
  const t = useT();
  const l = t.l;
  const style = useStore((s) => s.loreStyle);
  const [selId, setSelId] = useState(book.entries[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>(book.entries.length ? 'add' : 'world');
  const [source, setSource] = useState('');
  const [count, setCount] = useState(8);
  const [instr, setInstr] = useState('');
  const [autoKeys, setAutoKeys] = useState(true);
  const forge = useForge<Res>();

  const cur = book.entries.find((e) => e.id === selId);
  useEffect(() => {
    if (!cur && book.entries.length) setSelId(book.entries[0].id);
  }, [cur, book.entries]);

  const upd = (fn: (b: LoreBook) => LoreBook) => patchItem('lorebooks', book.id, fn);
  const updEntry = (id: string, patch: Partial<LoreEntry>) => upd((b) => ({ ...b, entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const addEntry = () => {
    const e = newEntry({ title: l.newEntryName });
    upd((b) => ({ ...b, entries: [...b.entries, e] }));
    setSelId(e.id);
    setQ('');
  };

  const query = q.trim().toLowerCase();
  const shown = query ? book.entries.filter((e) => [e.title, e.content, ...e.keys, ...e.secondary].some((s) => s.toLowerCase().includes(query))) : book.entries;
  const constCount = book.entries.filter((e) => e.constant).length;

  /* AI */
  const common = (): Common => {
    const s = getState();
    return { outLang: s.outLang, globalInstr: s.globalInstr, instr };
  };

  const runEntries = (msgs: ReturnType<typeof loreWorld>, withName: boolean) =>
    forge.run(
      msgs,
      (json) => {
        const arr = isObj(json) && Array.isArray(json.entries) ? json.entries : Array.isArray(json) ? json : [];
        const entries = arr.map((x) => parseEntry(x, autoKeys)).filter((e): e is LoreEntry => !!e);
        if (!entries.length) return null;
        return { kind: 'entries', bookId: book.id, name: withName && isObj(json) ? str(json.name) || undefined : undefined, entries };
      },
      { maxTokens: Math.max(getState().conn.maxTokens, count * 350) },
    );

  const forgeRun = (m: Mode = mode) => {
    if (m === 'world') runEntries(loreWorld(book, source, count, style, autoKeys, common()), true);
    else if (m === 'add') runEntries(loreAdd(book, source, count, style, autoKeys, common()), false);
    else if (cur) {
      const id = cur.id;
      forge.run(
        loreRegen(book, cur, source, style, autoKeys, common()),
        (json) => {
          const e = parseEntry(json, autoKeys);
          if (!e) return null;
          const patch: Partial<LoreEntry> = { title: e.title || cur.title, content: e.content };
          if (autoKeys && isObj(json) && json.keys) {
            patch.keys = e.keys;
            patch.secondary = e.secondary;
          }
          return { kind: 'regen', bookId: book.id, id, patch };
        },
        { plain: (text) => (text ? { kind: 'regen', bookId: book.id, id, patch: { content: text } } : null) },
      );
    }
  };

  const suggestKeys = () => {
    if (!cur) return;
    const id = cur.id;
    forge.run(loreKeys(cur, common()), (json) => {
      if (!isObj(json)) return null;
      const keys = strArr(json.keys);
      return keys.length ? { kind: 'keys', bookId: book.id, id, keys, secondary: strArr(json.secondary) } : null;
    });
  };

  const accept = (r: Res) => {
    if (r.kind === 'entries') {
      const isDefaultName = book.name === l.newBookName || !book.name.trim();
      patchItem('lorebooks', r.bookId, (b) => ({ ...b, name: r.name && isDefaultName ? r.name : b.name, entries: [...b.entries, ...r.entries] }));
      setSelId(r.entries[0].id);
    } else if (r.kind === 'regen') patchItem('lorebooks', r.bookId, (b) => ({ ...b, entries: b.entries.map((e) => (e.id === r.id ? { ...e, ...r.patch } : e)) }));
    else patchItem('lorebooks', r.bookId, (b) => ({ ...b, entries: b.entries.map((e) => (e.id === r.id ? { ...e, keys: r.keys, secondary: r.secondary } : e)) }));
  };

  const preview = (r: Res) => {
    if (r.kind === 'entries')
      return (
        <>
          {r.name && <p className="sum serif">{r.name}</p>}
          <p className="sum">{fmt(l.resEntries, { n: r.entries.length })}</p>
          <ol className="prev">
            {r.entries.map((e) => (
              <li key={e.id}>
                <b>{e.title}</b>
                {e.constant ? ' ◆' : ''} <span className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>[{e.keys.join(', ')}]</span> — {e.content.slice(0, 120)}
                {e.content.length > 120 ? '…' : ''}
              </li>
            ))}
          </ol>
        </>
      );
    if (r.kind === 'regen')
      return (
        <>
          <p className="sum serif">{r.patch.title}</p>
          {r.patch.keys && <p className="mono hint">[{r.patch.keys.join(', ')}]</p>}
          <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
            {r.patch.content}
          </pre>
        </>
      );
    return (
      <>
        <p className="sum">{l.keys}:</p>
        <div className="row" style={{ gap: 6 }}>
          {r.keys.map((k) => (
            <span key={k} className="key" style={{ paddingRight: 12 }}>
              {k}
            </span>
          ))}
        </div>
        {r.secondary.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            {r.secondary.map((k) => (
              <span key={k} className="key sec" style={{ paddingRight: 12 }}>
                {k}
              </span>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="work">
      <aside className="panel side" aria-label={l.bookLabel}>
        <div className="listhead">
          {books.length > 1 && (
            <select className="field mono" style={{ fontSize: 13 }} value={book.id} onChange={(e) => setState({ bookId: e.target.value })} aria-label={l.bookLabel}>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || t.c.untitled}
                </option>
              ))}
            </select>
          )}
          <input className="field mono" style={{ fontSize: 13, padding: '8px 12px' }} value={book.name} onChange={(e) => upd((b) => ({ ...b, name: e.target.value }))} aria-label={l.bookName} />
          <span className="count">
            {book.entries.length} {plural(book.entries.length, l.entriesForms)} · {constCount} {l.constWord}
          </span>
        </div>
        {book.entries.length > 4 && <input className="field" type="search" placeholder={l.searchPh} aria-label={l.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="list">
          {shown.map((e) => (
            <button key={e.id} type="button" className={['entry', e.id === selId && 'sel', !e.enabled && 'off'].filter(Boolean).join(' ')} aria-pressed={e.id === selId} onClick={() => setSelId(e.id)}>
              <span className="top">
                <span className={e.constant ? 'dia fill' : 'dia'} aria-hidden="true" />
                <span className="t">{e.title || t.c.untitled}</span>
                <span className="mono" style={{ fontSize: 11, opacity: 0.75 }}>
                  #{e.order}
                </span>
              </span>
              <span className="keys">{e.constant ? l.legendConst.toLowerCase() : e.keys.join(', ') || '—'}</span>
            </button>
          ))}
          {query && !shown.length && <p className="hint" style={{ padding: '0 8px' }}>{l.nothingFound}</p>}
        </div>
        {book.entries.length > 0 && (
          <div className="legend">
            <span>
              <span className="dia fill" />
              {l.legendConst}
            </span>
            <span>
              <span className="dia" />
              {l.legendKey}
            </span>
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-dashed w100" onClick={addEntry}>
          <Plus size={16} />
          {l.addEntry}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          style={{ alignSelf: 'center', background: 'transparent', color: 'var(--mute)' }}
          onClick={() => {
            if (!confirmDelete(book.name)) return;
            removeItem('lorebooks', book.id);
            setState({ bookId: '' });
          }}
        >
          <Trash size={14} />
          {l.deleteBook}
        </button>
      </aside>

      <section className="panel editor">
        {!book.entries.length ? (
          <p className="well">{l.noEntries}</p>
        ) : !cur ? (
          <p className="well">{l.selectHint}</p>
        ) : (
          <EntryEditor
            key={cur.id}
            e={cur}
            onPatch={(patch) => updEntry(cur.id, patch)}
            onRegen={() => {
              setMode('regen');
              forgeRun('regen');
            }}
            onKeys={suggestKeys}
            busy={forge.busy}
            onDelete={() => {
              if (!confirmDelete(cur.title)) return;
              const i = book.entries.indexOf(cur);
              const next = book.entries[i + 1] ?? book.entries[i - 1];
              upd((b) => ({ ...b, entries: b.entries.filter((x) => x.id !== cur.id) }));
              setSelId(next?.id ?? '');
            }}
          />
        )}
      </section>

      <Hearth
        sub={l.forgeSub}
        modes={
          <Modes
            label={t.h.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'world', label: l.modeWorld },
              { id: 'add', label: l.modeAdd },
              { id: 'regen', label: l.modeRegen },
            ]}
          />
        }
        cta={mode === 'world' ? l.ctaWorld : mode === 'add' ? l.ctaAdd : l.ctaRegen}
        blocked={mode === 'regen' && !cur ? l.selectHint : undefined}
        onForge={() => forgeRun()}
        forge={forge}
        preview={preview}
        onAccept={accept}
      >
        <Fld label={mode === 'world' ? l.worldLabel : mode === 'add' ? l.addLabel : l.regenLabel} htmlFor="lb-src">
          <textarea id="lb-src" className="field" rows={4} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={mode === 'world' ? l.worldPh : ''} value={source} onChange={(e) => setSource(e.target.value)} />
        </Fld>
        {mode !== 'regen' && (
          <Fld label={l.count} htmlFor="lb-count">
            <NumInput id="lb-count" value={count} min={1} max={40} onChange={setCount} />
          </Fld>
        )}
        <StylePicker<LoreStyle> label={l.styleLabel} value={style} ids={LORE_STYLES} names={t.styles.lore} onChange={(v) => setState({ loreStyle: v })} />
        <Fld label={t.h.ownLabel} htmlFor="lb-instr">
          <textarea id="lb-instr" className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={l.ownPh} value={instr} onChange={(e) => setInstr(e.target.value)} />
        </Fld>
        <label className="check">
          <input type="checkbox" checked={autoKeys} onChange={(e) => setAutoKeys(e.target.checked)} />
          {l.autoKeys}
        </label>
      </Hearth>
    </div>
  );
}

function EntryEditor({ e, onPatch, onRegen, onKeys, onDelete, busy }: { e: LoreEntry; onPatch: (p: Partial<LoreEntry>) => void; onRegen: () => void; onKeys: () => void; onDelete: () => void; busy: boolean }) {
  const t = useT();
  const l = t.l;
  const atDepth = e.position === 4;
  return (
    <>
      <Fld label={l.memo} htmlFor="lb-title">
        <input id="lb-title" className="field serif" style={{ fontSize: 20 }} value={e.title} onChange={(ev) => onPatch({ title: ev.target.value })} />
      </Fld>
      <div className="fld">
        <span className="label">{l.keys}</span>
        <KeyBox keys={e.keys} onChange={(keys) => onPatch({ keys })} placeholder={l.addKeyPh} removeLabel={l.removeKey} label={l.keys} />
      </div>
      <div className="grid" style={{ alignItems: 'end' }}>
        <div className="fld full">
          <span className="label">{l.secKeys}</span>
          <KeyBox keys={e.secondary} onChange={(secondary) => onPatch({ secondary })} secondary placeholder={l.addKeyPh} removeLabel={l.removeKey} label={l.secKeys} />
        </div>
        <Fld label={l.logic} htmlFor="lb-logic">
          <select id="lb-logic" className="field mono" style={{ fontSize: 13 }} value={e.logic} onChange={(ev) => onPatch({ logic: Number(ev.target.value) as LoreLogic })}>
            {l.logics.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </Fld>
        <Fld label={l.wholeWords} htmlFor="lb-ww">
          <select id="lb-ww" className="field" value={e.wholeWords === null ? 'null' : String(e.wholeWords)} onChange={(ev) => onPatch({ wholeWords: ev.target.value === 'null' ? null : ev.target.value === 'true' })}>
            <option value="null">{l.wwOptions[0]}</option>
            <option value="true">{l.wwOptions[1]}</option>
            <option value="false">{l.wwOptions[2]}</option>
          </select>
        </Fld>
        <div className="row" style={{ gap: 20 }}>
          <label className="check">
            <input type="checkbox" checked={e.constant} onChange={(ev) => onPatch({ constant: ev.target.checked })} />
            {l.constant}
          </label>
          <label className="check">
            <input type="checkbox" checked={e.enabled} onChange={(ev) => onPatch({ enabled: ev.target.checked })} />
            {l.enabled}
          </label>
        </div>
      </div>

      <Fld label={l.content} htmlFor="lb-content" extra={<Tok text={e.content} />}>
        <textarea id="lb-content" className="field" rows={7} style={{ minHeight: 160, fontSize: 14, lineHeight: 1.7 }} value={e.content} onChange={(ev) => onPatch({ content: ev.target.value })} />
      </Fld>

      <div className="grid sm" style={{ paddingTop: 18, borderTop: '1px dashed var(--line-2)' }}>
        <Fld label={l.order} htmlFor="lb-order">
          <NumInput id="lb-order" value={e.order} min={0} max={10000} onChange={(order) => onPatch({ order })} />
        </Fld>
        <Fld label={l.position} htmlFor="lb-pos">
          <select id="lb-pos" className="field" value={e.position} onChange={(ev) => onPatch({ position: Number(ev.target.value) })}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {l.positions[p]}
              </option>
            ))}
            {!(POSITIONS as readonly number[]).includes(e.position) && <option value={e.position}>#{e.position}</option>}
          </select>
        </Fld>
        {atDepth && (
          <>
            <Fld label={l.depth} htmlFor="lb-depth">
              <NumInput id="lb-depth" value={e.depth} min={0} max={1000} onChange={(depth) => onPatch({ depth })} />
            </Fld>
            <Fld label={l.role} htmlFor="lb-role">
              <select id="lb-role" className="field" value={e.role} onChange={(ev) => onPatch({ role: Number(ev.target.value) })}>
                <option value={0}>System</option>
                <option value={1}>User</option>
                <option value={2}>Assistant</option>
              </select>
            </Fld>
          </>
        )}
        <Fld label={l.prob} htmlFor="lb-prob">
          <NumInput id="lb-prob" value={e.probability} min={0} max={100} onChange={(probability) => onPatch({ probability })} />
        </Fld>
      </div>

      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={onRegen} disabled={busy}>
          <Regen size={16} />
          {l.regenEntry}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onKeys} disabled={busy}>
          <Key size={16} />
          {l.suggestKeys}
        </button>
        <button type="button" className="btn btn-sm btn-danger" style={{ background: 'transparent', color: 'var(--mute)', marginLeft: 'auto' }} onClick={onDelete}>
          <Trash size={14} />
          {l.deleteEntry}
        </button>
      </div>
    </>
  );
}
