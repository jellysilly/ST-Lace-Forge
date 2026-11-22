import { useEffect, useState, type ReactNode } from 'react';
import { go, href } from '../App';
import { Hearth } from '../components/Hearth';
import { Book, Download, Plus, Trash, Upload, X } from '../components/Icons';
import { STBar } from '../components/STBar';
import { Fld, Modes, NsfwSwitch, PageHead, StylePicker, TextFld, confirmDelete, errText, importFailed, toast } from '../components/ui';
import { useT } from '../i18n';
import { cardFromJson, cardFromPng, cardToPng, emptyCharacter, emptyPersona, personaToPng, personaToText, personasFrom, personasToST, toV2, toV3, type TextField } from '../lib/card';
import { avatarFromFile, avatarPng } from '../lib/image';
import { isObj, str, strArr } from '../lib/json';
import { lorebookFrom } from '../lib/lorebook';
import { isPng } from '../lib/png';
import { FILLABLE, GREET_SOURCE_MAX, charField, charFill, charGreeting, charNew, emptyFields, personaNew, personaRewrite, plotSource, type Common, type GreetTarget } from '../lib/prompts';
import { CHAR_STYLES, type CharStyle } from '../lib/styles';
import { getState, patchItem, removeItem, setState, upsert, useStore } from '../lib/store';
import type { CharacterDoc, PersonaDoc } from '../lib/types';
import { useForge } from '../lib/useForge';
import { download, fmt, pickFile, readBytes, slugify, splitList, tokens, utf8 } from '../lib/util';

type Tab = 'character' | 'persona';

export function Characters() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('character');
  return (
    <div className="page">
      <PageHead kicker={t.ch.kicker} title={t.ch.title}>
        <div role="group" aria-label={t.ch.tabsLabel} className="segs" style={{ padding: 3 }}>
          <button type="button" className={tab === 'character' ? 'tab on' : 'tab'} aria-pressed={tab === 'character'} onClick={() => setTab('character')}>
            {t.ch.tabChar}
          </button>
          <button type="button" className={tab === 'persona' ? 'tab on' : 'tab'} aria-pressed={tab === 'persona'} onClick={() => setTab('persona')}>
            {t.ch.tabPer}
          </button>
        </div>
      </PageHead>
      {tab === 'character' ? <CharacterWork /> : <PersonaWork />}
    </div>
  );
}

/* ───────── shared bits ───────── */

function Avatar({ src, name, className }: { src?: string; name: string; className: string }) {
  return <span className={className}>{src ? <img src={src} alt="" /> : <span className="serif">{(name.trim()[0] ?? '?').toUpperCase()}</span>}</span>;
}

function Library<T extends { id: string; name: string; avatar?: string }>({
  title,
  items,
  selId,
  onPick,
  meta,
  newLabel,
  onNew,
  onImport,
  extra,
}: {
  extra?: ReactNode;
  title: string;
  items: T[];
  selId: string;
  onPick: (id: string) => void;
  meta: (x: T) => string;
  newLabel: string;
  onNew: () => void;
  onImport: () => void;
}) {
  const t = useT();
  return (
    <aside className="panel side" aria-label={title} style={{ maxWidth: 320 }}>
      <span className="label" style={{ padding: '0 8px' }}>
        {title}
      </span>
      <div className="list">
        {items.length === 0 && <p className="hint" style={{ padding: '0 8px' }}>{t.ch.emptyLib}</p>}
        {items.map((x) => (
          <button key={x.id} type="button" className={x.id === selId ? 'card sel' : 'card'} aria-pressed={x.id === selId} onClick={() => onPick(x.id)}>
            <Avatar className="ava" src={x.avatar} name={x.name} />
            <span className="txt">
              <b>{x.name || t.c.untitled}</b>
              <small>{meta(x)}</small>
            </span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: '1px dashed var(--line-2)' }}>
        <button type="button" className="btn btn-ghost btn-dashed w100" onClick={onNew}>
          <Plus size={16} />
          {newLabel}
        </button>
        <button type="button" className="btn btn-ghost w100" onClick={onImport}>
          <Download size={16} />
          {t.ch.import}
        </button>
        {extra}
      </div>
    </aside>
  );
}

function Portrait({ src, name, onChange }: { src?: string; name: string; onChange: (src: string | undefined) => void }) {
  const t = useT();
  const upload = async () => {
    const [f] = await pickFile('image/*');
    if (!f) return;
    try {
      onChange(await avatarFromFile(f));
    } catch (e) {
      importFailed(f.name, e);
    }
  };
  return (
    <div style={{ flex: 'none', width: 148, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <Avatar className="portrait" src={src} name={name} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={upload}>
        {t.ch.avatar}
      </button>
      {src && (
        <button type="button" className="btn btn-sm btn-danger" style={{ background: 'transparent', color: 'var(--mute)', minHeight: 32 }} onClick={() => onChange(undefined)}>
          {t.ch.removeAvatar}
        </button>
      )}
    </div>
  );
}

function Formats({ list, value, onChange, onExport, note }: { list: string[]; value: string; onChange: (f: string) => void; onExport: () => void; note?: string }) {
  const t = useT();
  return (
    <div className="fld">
      <span className="label">{t.ch.exportAs}</span>
      <div className="row" style={{ gap: 8 }}>
        {list.map((f) => (
          <button key={f} type="button" className={f === value ? 'fmt on' : 'fmt'} aria-pressed={f === value} onClick={() => onChange(f)}>
            {f}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
          <Upload size={14} />
          {t.c.export}
        </button>
      </div>
      {note && <p className="hint" style={{ fontSize: 12 }}>{note}</p>}
    </div>
  );
}

const commonOf = (instr: string): Common => {
  const s = getState();
  return { outLang: s.outLang, globalInstr: s.globalInstr, instr };
};

/* ───────── characters ───────── */

type CharMode = 'new' | 'fill' | 'field' | 'greet';
type CharRes =
  | { kind: 'new'; card: CharacterDoc }
  | { kind: 'fill'; id: string; patch: Partial<CharacterDoc> }
  | { kind: 'field'; id: string; field: TextField; value: string }
  | { kind: 'greet'; id: string; target: GreetTarget; value: string };

/** Plots link here as #/characters?greet=<plotId> to write a greeting from that plot. */
const greetParam = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('greet') ?? '';

const MAIN_FIELDS: [TextField, number][] = [
  ['description', 6],
  ['personality', 2],
  ['scenario', 3],
  ['first_mes', 5],
  ['mes_example', 5],
];
const EXTRA_FIELDS: [TextField, number][] = [
  ['creator_notes', 3],
  ['system_prompt', 3],
  ['post_history_instructions', 3],
];

const charTokens = (c: CharacterDoc) => tokens([c.description, c.personality, c.scenario, c.first_mes, c.mes_example].join(''));

function cardPatch(json: unknown, keys: readonly string[]): Partial<CharacterDoc> {
  const out: Record<string, unknown> = {};
  if (!isObj(json)) return out;
  for (const k of keys) {
    if (!(k in json)) continue;
    if (k === 'alternate_greetings' || k === 'tags') out[k] = strArr(json[k]);
    else if (str(json[k]).trim()) out[k] = str(json[k]);
  }
  return out as Partial<CharacterDoc>;
}

function CharacterWork() {
  const t = useT();
  const ch = t.ch;
  const list = useStore((s) => s.characters);
  const charId = useStore((s) => s.charId);
  const style = useStore((s) => s.charStyle);
  const cur = list.find((x) => x.id === charId) ?? list[0];
  const [fmtSel, setFmt] = useState('PNG V3');
  const [mode, setMode] = useState<CharMode>(() => (greetParam() ? 'greet' : 'new'));
  const [hot, setHot] = useState<TextField>('description');
  const [idea, setIdea] = useState('');
  const [instr, setInstr] = useState('');
  const plots = useStore((s) => s.plots);
  const nsfw = useStore((s) => s.nsfw);
  const [greetPlot, setGreetPlot] = useState(greetParam);
  const [greetFile, setGreetFile] = useState<{ name: string; text: string } | null>(null);
  const [greetTarget, setGreetTarget] = useState<GreetTarget>(() => (cur?.first_mes.trim() ? 'alt' : 'first'));
  const forge = useForge<CharRes>();

  // The ?greet= link is a one-off: drop it so a reload doesn't reopen it.
  useEffect(() => {
    if (location.hash.includes('?')) history.replaceState(null, '', href('characters'));
  }, []);

  const upd = (patch: Partial<CharacterDoc>) => cur && patchItem('characters', cur.id, (c) => ({ ...c, ...patch }));

  const createNew = () => {
    const c = emptyCharacter(ch.newChar);
    upsert('characters', c);
    setState({ charId: c.id });
  };

  const doImport = async () => {
    const files = await pickFile('.png,.json,image/png,application/json', true);
    let last = '';
    for (const f of files) {
      try {
        const bytes = await readBytes(f);
        let c: CharacterDoc;
        if (isPng(bytes)) c = cardFromPng(bytes);
        else {
          let obj: unknown;
          try {
            obj = JSON.parse(utf8.decode(bytes));
          } catch {
            throw new Error('json');
          }
          c = cardFromJson(obj);
        }
        if (!c.name) c.name = f.name.replace(/\.[a-z]+$/i, '');
        upsert('characters', c);
        last = c.id;
        toast(fmt(t.c.imported, { what: c.name }));
      } catch (e) {
        importFailed(f.name, e);
      }
    }
    if (last) setState({ charId: last });
  };

  const doExport = async () => {
    if (!cur) return;
    const base = slugify(cur.name, 'character');
    try {
      if (fmtSel === 'PNG V3') {
        const png = cardToPng(cur, await avatarPng(cur.avatar, cur.name));
        download(`${base}.png`, png, 'image/png');
        toast(fmt(t.c.exported, { name: `${base}.png` }));
      } else {
        const v3 = fmtSel === 'JSON V3';
        const name = `${base}${v3 ? '' : '.v2'}.json`;
        download(name, JSON.stringify(v3 ? toV3(cur) : toV2(cur), null, 2));
        toast(fmt(t.c.exported, { name }));
      }
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const book = cur && isObj(cur.raw?.character_book) ? cur.raw.character_book : null;
  const bookCount = book && Array.isArray(book.entries) ? book.entries.length : 0;

  const loadGreetFile = async () => {
    const [f] = await pickFile('.md,.markdown,.txt,text/markdown,text/plain');
    if (!f) return;
    const text = (await f.text()).trim();
    if (!text) return toast(fmt(ch.greetFileEmpty, { name: f.name }), true);
    setGreetFile({ name: f.name, text });
  };

  /* AI */
  const missing = cur ? emptyFields(cur) : [];
  const greetPlotDoc = plots.find((p) => p.id === greetPlot);
  const greetSource = greetFile ? greetFile.text : greetPlotDoc ? plotSource(greetPlotDoc) : '';
  const forgeRun = (m: CharMode = mode, field: TextField = hot) => {
    const c = commonOf(instr);
    if (m === 'new') {
      forge.run(charNew(idea, style, c), (json) => {
        const patch = cardPatch(json, [...FILLABLE, 'alternate_greetings', 'tags']);
        if (!patch.description && !patch.first_mes) return null;
        return { kind: 'new', card: { ...emptyCharacter(), ...patch, name: patch.name || ch.newChar } };
      });
    } else if (m === 'fill' && cur) {
      const keys = emptyFields(cur);
      forge.run(charFill(cur, idea, style, c), (json) => {
        const patch = cardPatch(json, keys);
        return Object.keys(patch).length ? { kind: 'fill', id: cur.id, patch } : null;
      });
    } else if (m === 'field' && cur) {
      const make = (value: string): CharRes | null => (value.trim() ? { kind: 'field', id: cur.id, field, value } : null);
      forge.run(charField(cur, field, idea, style, c), (json) => make(isObj(json) ? str(json.value ?? json[field] ?? json.text) : typeof json === 'string' ? json : ''), { plain: make });
    } else if (m === 'greet' && cur && greetSource) {
      const target = greetTarget;
      const make = (value: string): CharRes | null => (value.trim() ? { kind: 'greet', id: cur.id, target, value } : null);
      forge.run(charGreeting(cur, greetSource, target, idea, getState().nsfw, c), (json) => make(isObj(json) ? str(json.value ?? json.first_mes ?? json.greeting ?? json.text) : typeof json === 'string' ? json : ''), {
        plain: make,
      });
    }
  };

  const accept = (r: CharRes) => {
    if (r.kind === 'new') {
      upsert('characters', r.card);
      setState({ charId: r.card.id });
    } else if (r.kind === 'fill') patchItem('characters', r.id, (c) => ({ ...c, ...r.patch }));
    else if (r.kind === 'greet') patchItem('characters', r.id, (c) => (r.target === 'first' ? { ...c, first_mes: r.value } : { ...c, alternate_greetings: [...c.alternate_greetings, r.value] }));
    else patchItem('characters', r.id, (c) => ({ ...c, [r.field]: r.value }));
  };

  const preview = (r: CharRes): ReactNode => {
    if (r.kind === 'greet')
      return (
        <>
          <p className="sum">{r.target === 'first' ? ch.greetToFirst : fmt(ch.greetToAlt, { n: (list.find((x) => x.id === r.id)?.alternate_greetings.length ?? 0) + 1 })}</p>
          <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
            {r.value}
          </pre>
        </>
      );
    if (r.kind === 'field')
      return (
        <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
          {r.value}
        </pre>
      );
    const patch = r.kind === 'new' ? r.card : r.patch;
    const keys = (r.kind === 'new' ? ['name', ...MAIN_FIELDS.map((f) => f[0])] : Object.keys(r.patch)) as (keyof CharacterDoc)[];
    return (
      <>
        {r.kind === 'new' && <p className="sum serif">{r.card.name}</p>}
        <p className="sum">{fmt(ch.resFields, { n: keys.filter((k) => String(patch[k] ?? '').trim()).length })}</p>
        <ul className="prev">
          {keys
            .filter((k) => k !== 'name' || r.kind !== 'new')
            .map((k) => (
              <li key={k}>
                <b>{ch.fields[k] ?? (k === 'name' ? ch.name : k)}</b> — {String(patch[k] ?? '').slice(0, 160)}
                {String(patch[k] ?? '').length > 160 ? '…' : ''}
              </li>
            ))}
        </ul>
      </>
    );
  };

  const blocked = mode !== 'new' && !cur ? ch.emptyLib : mode === 'fill' && !missing.length ? ch.fillNone : mode === 'greet' && !greetSource ? ch.greetNeedSource : undefined;
  // ↻ next to a field reforges it right away, using the idea and instruction typed in the hearth.
  const target = (f: TextField) => {
    setHot(f);
    setMode('field');
    if (!forge.busy) forgeRun('field', f);
  };

  return (
    <div className="work">
      <Library
        title={ch.libChar}
        items={list}
        selId={cur?.id ?? ''}
        onPick={(id) => setState({ charId: id })}
        meta={(c) => `${c.spec && c.spec !== 'new' ? c.spec.toUpperCase() + ' · ' : ''}~${charTokens(c)} ${t.c.tok}`}
        newLabel={ch.newChar}
        onNew={createNew}
        onImport={doImport}
        extra={<STBar kind="characters" current={cur} block />}
      />

      <section className="panel editor">
        {!cur ? (
          <p className="well">{ch.emptyLib}</p>
        ) : (
          <>
            <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
              <Portrait src={cur.avatar} name={cur.name} onChange={(avatar) => upd({ avatar })} />
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Fld label={ch.name} htmlFor="ch-name">
                  <input id="ch-name" className="field serif" style={{ fontSize: 22 }} value={cur.name} onChange={(e) => upd({ name: e.target.value })} />
                </Fld>
                <Formats list={['PNG V3', 'JSON V3', 'JSON V2']} value={fmtSel} onChange={setFmt} onExport={doExport} note={fmtSel === 'PNG V3' ? ch.pngNote : undefined} />
                <span className="tokn">
                  {ch.total}: ~{charTokens(cur)} {t.c.tok}
                </span>
              </div>
            </div>

            {MAIN_FIELDS.map(([f, rows]) => (
              <TextFld key={f} id={'f-' + f} label={ch.fields[f]} rows={rows} value={cur[f]} onChange={(v) => upd({ [f]: v })} hot={mode === 'field' && hot === f} onTarget={() => target(f)} regenLabel={ch.regenField} />
            ))}

            <div className="fld">
              <span className="label">{ch.altGreetings}</span>
              {cur.alternate_greetings.map((g, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <textarea
                    className="field"
                    rows={3}
                    style={{ fontSize: 14 }}
                    aria-label={fmt(ch.altN, { n: i + 1 })}
                    placeholder={fmt(ch.altN, { n: i + 1 })}
                    value={g}
                    onChange={(e) => upd({ alternate_greetings: cur.alternate_greetings.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  <button type="button" className="iconbtn" aria-label={t.c.delete} title={t.c.delete} onClick={() => upd({ alternate_greetings: cur.alternate_greetings.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-dashed btn-sm" onClick={() => upd({ alternate_greetings: [...cur.alternate_greetings, ''] })}>
                  <Plus size={14} />
                  {ch.altAdd}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setGreetTarget('alt');
                    setMode('greet');
                    document.querySelector('.hearth')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <Book size={14} />
                  {ch.altFromPlot}
                </button>
              </div>
            </div>

            <details className="fld">
              <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
                {ch.more}
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 12 }}>
                {EXTRA_FIELDS.map(([f, rows]) => (
                  <TextFld key={f} id={'f-' + f} label={ch.fields[f]} rows={rows} value={cur[f]} onChange={(v) => upd({ [f]: v })} hot={mode === 'field' && hot === f} onTarget={() => target(f)} regenLabel={ch.regenField} />
                ))}
                <div className="grid">
                  <Fld label={ch.tags} htmlFor="ch-tags" className="full">
                    <input id="ch-tags" className="field" placeholder={ch.tagsPh} defaultValue={cur.tags.join(', ')} key={cur.id + cur.tags.join()} onBlur={(e) => upd({ tags: splitList(e.target.value) })} />
                  </Fld>
                  <Fld label={ch.creator} htmlFor="ch-creator">
                    <input id="ch-creator" className="field" value={cur.creator} onChange={(e) => upd({ creator: e.target.value })} />
                  </Fld>
                  <Fld label={ch.version} htmlFor="ch-ver">
                    <input id="ch-ver" className="field" value={cur.character_version} onChange={(e) => upd({ character_version: e.target.value })} />
                  </Fld>
                </div>
              </div>
            </details>

            {bookCount > 0 && (
              <div className="note plain row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  <Book size={16} />
                  {fmt(ch.embeddedBook, { n: bookCount })}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    try {
                      const b = lorebookFrom({ character_book: book }, cur.name);
                      upsert('lorebooks', b);
                      setState({ bookId: b.id });
                      toast(fmt(ch.bookExtracted, { name: b.name }));
                      go(href('lorebooks'));
                    } catch (e) {
                      toast(errText(e), true);
                    }
                  }}
                >
                  {ch.extractBook}
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn btn-sm btn-danger"
              style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--mute)' }}
              onClick={() => {
                if (!confirmDelete(cur.name)) return;
                removeItem('characters', cur.id);
                setState({ charId: '' });
              }}
            >
              <Trash size={14} />
              {ch.deleteChar}
            </button>
          </>
        )}
      </section>

      <Hearth
        sub={ch.forgeSub}
        modes={
          <Modes
            label={t.h.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'new', label: ch.modeNew },
              { id: 'fill', label: ch.modeFill },
              { id: 'field', label: ch.modeField },
              { id: 'greet', label: ch.modeGreet },
            ]}
          />
        }
        cta={mode === 'new' ? ch.ctaNew : mode === 'fill' ? ch.ctaFill : mode === 'field' ? ch.ctaField : greetTarget === 'first' ? ch.ctaGreetFirst : ch.ctaGreetAlt}
        blocked={blocked}
        onForge={() => forgeRun()}
        forge={forge}
        preview={preview}
        onAccept={accept}
      >
        {mode === 'field' && <p className="note">{fmt(ch.fieldNote, { f: ch.fields[hot] })}</p>}
        {mode === 'new' && <p className="hint">{ch.newNote}</p>}
        {mode === 'fill' && missing.length > 0 && <p className="hint">{fmt(ch.fillNote, { list: missing.map((k) => (k === 'name' ? ch.name : ch.fields[k])).join(', ') })}</p>}
        {mode === 'greet' && (
          <>
            <p className="hint">{fmt(ch.greetNote, { name: cur?.name || t.c.untitled })}</p>
            <div className="fld">
              <label className="label" htmlFor="ch-greet-plot">
                {ch.greetSource}
              </label>
              {greetFile ? (
                <div className="filechip">
                  <span className="mono">{greetFile.name}</span>
                  <span className="tokn">
                    ~{tokens(greetFile.text)} {t.c.tok}
                  </span>
                  <button type="button" className="iconbtn sm" aria-label={ch.greetFileRemove} title={ch.greetFileRemove} onClick={() => setGreetFile(null)}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <select id="ch-greet-plot" className="field" disabled={!plots.length} value={greetPlotDoc ? greetPlot : ''} onChange={(e) => setGreetPlot(e.target.value)}>
                  <option value="">{plots.length ? ch.greetPlotNone : ch.greetNoPlots}</option>
                  {plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.title || t.c.untitled) + (p.nsfw ? ' · 18+' : '')}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={loadGreetFile}>
                <Download size={14} />
                {ch.greetFile}
              </button>
              {greetFile && greetFile.text.length > GREET_SOURCE_MAX && <p className="hint">{fmt(ch.greetLong, { n: tokens(greetFile.text.slice(0, GREET_SOURCE_MAX)) })}</p>}
            </div>
            <div className="fld">
              <span className="label">{ch.greetTarget}</span>
              <Modes
                label={ch.greetTarget}
                value={greetTarget}
                onChange={setGreetTarget}
                options={[
                  { id: 'first', label: ch.greetFirst },
                  { id: 'alt', label: ch.greetAlt },
                ]}
              />
            </div>
            <div className="row">
              <NsfwSwitch />
            </div>
            <p className={nsfw ? 'note' : 'note plain'}>{nsfw ? t.pl.nsfwOn : t.pl.nsfwOff}</p>
          </>
        )}
        <Fld label={ch.ideaLabel} htmlFor="ch-idea">
          <textarea id="ch-idea" className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={ch.ideaPh} value={idea} onChange={(e) => setIdea(e.target.value)} />
        </Fld>
        {mode !== 'greet' && <StylePicker<CharStyle> label={ch.styleLabel} value={style} ids={CHAR_STYLES} names={t.styles.char} onChange={(v) => setState({ charStyle: v })} />}
        <Fld label={t.h.ownLabel} htmlFor="ch-instr">
          <textarea id="ch-instr" className="field" rows={4} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={ch.ownPh} value={instr} onChange={(e) => setInstr(e.target.value)} />
        </Fld>
      </Hearth>
    </div>
  );
}

/* ───────── personas ───────── */

type PerMode = 'new' | 'rewrite';
type PerRes = { kind: 'new'; persona: PersonaDoc } | { kind: 'rewrite'; id: string; description: string };

function PersonaWork() {
  const t = useT();
  const ch = t.ch;
  const list = useStore((s) => s.personas);
  const personaId = useStore((s) => s.personaId);
  const style = useStore((s) => s.charStyle);
  const cur = list.find((x) => x.id === personaId) ?? list[0];
  const [fmtSel, setFmt] = useState('JSON (ST)');
  const [mode, setMode] = useState<PerMode>('new');
  const [idea, setIdea] = useState('');
  const [instr, setInstr] = useState('');
  const forge = useForge<PerRes>();

  const upd = (patch: Partial<PersonaDoc>) => cur && patchItem('personas', cur.id, (p) => ({ ...p, ...patch }));

  const createNew = () => {
    const p = emptyPersona(ch.newPer);
    upsert('personas', p);
    setState({ personaId: p.id });
  };

  const doImport = async () => {
    const files = await pickFile('.png,.json,.txt,image/png,application/json,text/plain', true);
    let last = '';
    for (const f of files) {
      try {
        const items = personasFrom(await readBytes(f), f.name);
        for (const p of items) upsert('personas', p);
        last = items[0]?.id ?? last;
        toast(fmt(t.c.imported, { what: items.map((p) => p.name).join(', ') }));
      } catch (e) {
        importFailed(f.name, e);
      }
    }
    if (last) setState({ personaId: last });
  };

  const doExport = async () => {
    if (!cur) return;
    const base = slugify(cur.name, 'persona');
    try {
      let name: string;
      if (fmtSel === 'PNG') {
        name = `${base}.png`;
        download(name, personaToPng(cur, await avatarPng(cur.avatar, cur.name)), 'image/png');
      } else if (fmtSel === 'TXT') {
        name = `${base}.txt`;
        download(name, personaToText(cur), 'text/plain');
      } else {
        name = `${base}.personas.json`;
        download(name, JSON.stringify(personasToST([cur]), null, 2));
      }
      toast(fmt(t.c.exported, { name }));
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const forgeRun = (m: PerMode = mode) => {
    const c = commonOf(instr);
    if (m === 'new') {
      forge.run(personaNew(idea, style, c), (json) => {
        if (!isObj(json) || !str(json.description).trim()) return null;
        return { kind: 'new', persona: { ...emptyPersona(str(json.name) || ch.newPer), description: str(json.description) } };
      });
    } else if (cur) {
      const make = (d: string): PerRes | null => (d.trim() ? { kind: 'rewrite', id: cur.id, description: d } : null);
      forge.run(personaRewrite(cur, idea, style, c), (json) => make(isObj(json) ? str(json.description ?? json.value ?? json.text) : typeof json === 'string' ? json : ''), { plain: make });
    }
  };

  const accept = (r: PerRes) => {
    if (r.kind === 'new') {
      upsert('personas', r.persona);
      setState({ personaId: r.persona.id });
    } else patchItem('personas', r.id, (p) => ({ ...p, description: r.description }));
  };

  return (
    <div className="work">
      <Library
        title={ch.libPer}
        items={list}
        selId={cur?.id ?? ''}
        onPick={(id) => setState({ personaId: id })}
        meta={(p) => `~${tokens(p.description)} ${t.c.tok}`}
        newLabel={ch.newPer}
        onNew={createNew}
        onImport={doImport}
        extra={<STBar kind="personas" current={cur} block />}
      />

      <section className="panel editor">
        {!cur ? (
          <p className="well">{ch.emptyLib}</p>
        ) : (
          <>
            <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
              <Portrait src={cur.avatar} name={cur.name} onChange={(avatar) => upd({ avatar })} />
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Fld label={ch.name} htmlFor="pe-name">
                  <input id="pe-name" className="field serif" style={{ fontSize: 22 }} value={cur.name} onChange={(e) => upd({ name: e.target.value })} />
                </Fld>
                <Formats list={['JSON (ST)', 'TXT', 'PNG']} value={fmtSel} onChange={setFmt} onExport={doExport} note={fmtSel === 'PNG' ? ch.perPngNote : undefined} />
              </div>
            </div>
            <TextFld id="pe-desc" label={ch.personaDesc} rows={10} value={cur.description} onChange={(v) => upd({ description: v })} hot={mode === 'rewrite'} onTarget={() => {
                setMode('rewrite');
                if (!forge.busy) forgeRun('rewrite');
              }} regenLabel={ch.regenField} />
            <button
              type="button"
              className="btn btn-sm btn-danger"
              style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--mute)' }}
              onClick={() => {
                if (!confirmDelete(cur.name)) return;
                removeItem('personas', cur.id);
                setState({ personaId: '' });
              }}
            >
              <Trash size={14} />
              {ch.deletePer}
            </button>
          </>
        )}
      </section>

      <Hearth
        sub={ch.forgeSubPer}
        modes={
          <Modes
            label={t.h.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'new', label: ch.modeNew },
              { id: 'rewrite', label: ch.modeRewrite },
            ]}
          />
        }
        cta={mode === 'new' ? ch.ctaPerNew : ch.ctaPerRewrite}
        blocked={mode === 'rewrite' && !cur ? ch.emptyLib : undefined}
        onForge={() => forgeRun()}
        forge={forge}
        preview={(r) =>
          r.kind === 'new' ? (
            <>
              <p className="sum serif">{r.persona.name}</p>
              <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
                {r.persona.description}
              </pre>
            </>
          ) : (
            <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
              {r.description}
            </pre>
          )
        }
        onAccept={accept}
      >
        {mode === 'new' && <p className="hint">{ch.newNotePer}</p>}
        <Fld label={ch.ideaLabel} htmlFor="pe-idea">
          <textarea id="pe-idea" className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={ch.ideaPh} value={idea} onChange={(e) => setIdea(e.target.value)} />
        </Fld>
        <StylePicker<CharStyle> label={ch.styleLabel} value={style} ids={CHAR_STYLES} names={t.styles.char} onChange={(v) => setState({ charStyle: v })} />
        <Fld label={t.h.ownLabel} htmlFor="pe-instr">
          <textarea id="pe-instr" className="field" rows={4} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={ch.ownPh} value={instr} onChange={(e) => setInstr(e.target.value)} />
        </Fld>
      </Hearth>
    </div>
  );
}
