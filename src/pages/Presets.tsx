import { useEffect, useMemo, useState } from 'react';
import { Hearth } from '../components/Hearth';
import { Copy, Down, Download, Pin, Plus, Regen, Scissors, Split, Trash, Up, Upload } from '../components/Icons';
import { Fld, Modes, NumInput, PageHead, StylePicker, Switch, Tok, confirmDelete, importFailed, toast } from '../components/ui';
import { STBar } from '../components/STBar';
import { useT } from '../i18n';
import { isObj, str } from '../lib/json';
import { emptyPreset, importPreset, newBlock, toSillyTavern } from '../lib/preset';
import { presetNewBlocks, presetRegenBlock, presetRegenMini, presetSplitBlock, type Common } from '../lib/prompts';
import { PRESET_STYLES, type PresetStyle } from '../lib/styles';
import { getState, patchItem, removeItem, setState, upsert, useStore } from '../lib/store';
import type { PresetBlock, PresetDoc, Role } from '../lib/types';
import { useForge } from '../lib/useForge';
import { download, fmt, pickFile, plural, slugify, uid } from '../lib/util';

type Mode = 'new' | 'regen' | 'split';

type Res =
  | { kind: 'blocks'; after: string | null; blocks: { name: string; role: Role; content: string }[] }
  | { kind: 'regen'; blockId: string; name: string; content: string }
  | { kind: 'split'; blockId: string; minis: string[] }
  | { kind: 'mini'; blockId: string; miniId: string; index: number; text: string };

const roleOf = (v: unknown): Role => (v === 'user' || v === 'assistant' ? v : 'system');

export function Presets() {
  const t = useT();
  const p = t.p;
  const presets = useStore((s) => s.presets);
  const presetId = useStore((s) => s.presetId);
  const doc = presets.find((x) => x.id === presetId) ?? presets[0];

  const createNew = () => {
    const d = emptyPreset(p.newPresetName);
    upsert('presets', d);
    setState({ presetId: d.id });
  };

  const doImport = async () => {
    const files = await pickFile('.json,application/json', true);
    let last = '';
    for (const f of files) {
      try {
        const d = importPreset(await f.text(), f.name);
        upsert('presets', d);
        last = d.id;
        toast(fmt(t.c.imported, { what: d.name }));
      } catch (e) {
        importFailed(f.name, e);
      }
    }
    if (last) setState({ presetId: last });
  };

  return (
    <div className="page">
      <PageHead kicker={p.kicker} title={p.title}>
        <button type="button" className="btn btn-ghost" onClick={doImport}>
          <Download size={16} />
          {p.import}
        </button>
        {doc && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const name = `${slugify(doc.name, 'preset')}.json`;
              download(name, JSON.stringify(toSillyTavern(doc), null, 4));
              toast(fmt(t.c.exported, { name }));
            }}
          >
            <Upload size={16} />
            {t.c.export}
          </button>
        )}
        <STBar kind="presets" current={doc} />
        <button type="button" className="btn btn-ghost" onClick={createNew}>
          <Plus size={16} />
          {p.newPreset}
        </button>
      </PageHead>
      {doc ? (
        <Workspace key={doc.id} doc={doc} presets={presets} />
      ) : (
        <section className="panel empty">
          <h2 className="serif">{p.emptyTitle}</h2>
          <p>{p.emptyText}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-fire" onClick={createNew}>
              <Plus size={16} />
              {p.newPreset}
            </button>
            <button type="button" className="btn btn-ghost" onClick={doImport}>
              <Download size={16} />
              {p.import}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Workspace({ doc, presets }: { doc: PresetDoc; presets: PresetDoc[] }) {
  const t = useT();
  const p = t.p;
  const style = useStore((s) => s.presetStyle);
  const firstPrompt = doc.blocks.find((b) => !b.marker)?.id ?? doc.blocks[0]?.id ?? '';
  const [selId, setSelId] = useState(firstPrompt);
  const [mode, setMode] = useState<Mode>('regen');
  const [instr, setInstr] = useState('');
  const [count, setCount] = useState(1);
  const [ctxOther, setCtxOther] = useState(true);
  const [keepMacros, setKeepMacros] = useState(true);
  const forge = useForge<Res>();

  const sel = doc.blocks.find((b) => b.id === selId);
  const selIdx = sel ? doc.blocks.indexOf(sel) : -1;

  useEffect(() => {
    if (!sel && doc.blocks.length) setSelId(firstPrompt);
  }, [sel, doc.blocks.length, firstPrompt]);

  const upd = (fn: (d: PresetDoc) => PresetDoc) => patchItem('presets', doc.id, fn);
  const updBlock = (id: string, patch: Partial<PresetBlock> | ((b: PresetBlock) => Partial<PresetBlock>)) =>
    upd((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b)) }));

  const move = (dir: -1 | 1) =>
    upd((d) => {
      const i = d.blocks.findIndex((b) => b.id === selId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });

  const insertAt = (d: PresetDoc, after: string | null, items: PresetBlock[]) => {
    let i = after ? d.blocks.findIndex((b) => b.id === after) + 1 : -1;
    if (i <= 0) {
      const hist = d.blocks.findIndex((b) => b.identifier === 'chatHistory');
      i = hist >= 0 ? hist : d.blocks.length;
    }
    const blocks = [...d.blocks];
    blocks.splice(i, 0, ...items);
    return { ...d, blocks };
  };

  const addBlock = () => {
    const b = newBlock({ name: p.newBlockName });
    upd((d) => insertAt(d, selId || null, [b]));
    setSelId(b.id);
  };

  const removeBlock = () => {
    if (!sel || !confirmDelete(sel.name)) return;
    const next = doc.blocks[selIdx + 1] ?? doc.blocks[selIdx - 1];
    upd((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== sel.id) }));
    setSelId(next?.id ?? '');
  };

  const duplicate = () => {
    if (!sel) return;
    const b: PresetBlock = { ...sel, id: uid(), identifier: uid(), name: sel.name + ' (2)', minis: sel.minis.map((m) => ({ ...m, id: uid() })), raw: undefined };
    upd((d) => insertAt(d, sel.id, [b]));
    setSelId(b.id);
  };

  const minisToBlocks = () => {
    if (!sel?.minis.length) return;
    const items = sel.minis.map((m, i) => newBlock({ name: `${sel.name} · ${i + 1}`, role: sel.role, position: sel.position, depth: sel.depth, order: sel.order, content: m.text, enabled: sel.enabled }));
    upd((d) => {
      const withNew = insertAt(d, sel.id, items);
      return { ...withNew, blocks: withNew.blocks.filter((b) => b.id !== sel.id) };
    });
    setSelId(items[0].id);
  };

  /* ───────── AI ───────── */

  const common = (): Common => {
    const s = getState();
    return { outLang: s.outLang, globalInstr: s.globalInstr, instr, keepMacros };
  };
  const editable = sel && !sel.marker ? sel : undefined;

  const forgeRun = (m: Mode = mode) => {
    if (m === 'new') {
      const after = selId || null;
      forge.run(presetNewBlocks(doc, count, style, ctxOther, common()), (json) => {
        const arr = isObj(json) && Array.isArray(json.blocks) ? json.blocks : Array.isArray(json) ? json : isObj(json) && json.content ? [json] : [];
        const blocks = arr.filter(isObj).map((b) => ({ name: str(b.name) || p.newBlockName, role: roleOf(b.role), content: str(b.content) })).filter((b) => b.content.trim());
        return blocks.length ? { kind: 'blocks', after, blocks } : null;
      });
    } else if (m === 'regen' && editable) {
      forge.run(
        presetRegenBlock(doc, editable, style, ctxOther, common()),
        (json) => {
          const content = isObj(json) ? str(json.content ?? json.text ?? json.value) : typeof json === 'string' ? json : '';
          if (!content.trim()) return null;
          return { kind: 'regen', blockId: editable.id, name: (isObj(json) && str(json.name)) || editable.name, content };
        },
        { plain: (text) => (text ? { kind: 'regen', blockId: editable.id, name: editable.name, content: text } : null) },
      );
    } else if (m === 'split' && editable) {
      forge.run(presetSplitBlock(editable, style, common()), (json) => {
        const arr = isObj(json) && Array.isArray(json.minis) ? json.minis : Array.isArray(json) ? json : [];
        const minis = arr.map((x) => (typeof x === 'string' ? x : isObj(x) ? str(x.text) : '')).map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
        return minis.length ? { kind: 'split', blockId: editable.id, minis } : null;
      }, { plain: (text) => {
        const minis = text.split('\n').map((x) => x.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
        return minis.length > 1 ? { kind: 'split', blockId: editable.id, minis } : null;
      } });
    }
  };

  const regenMini = (index: number) => {
    if (!editable) return;
    const mini = editable.minis[index];
    const make = (text: string): Res | null => (text.trim() ? { kind: 'mini', blockId: editable.id, miniId: mini.id, index, text: text.replace(/^\s*\d+[.)]\s*/, '').trim() } : null);
    forge.run(presetRegenMini(editable, index, style, common()), (json) => make(isObj(json) ? str(json.text ?? json.content ?? json.value) : typeof json === 'string' ? json : ''), { plain: make });
  };

  const accept = (r: Res) => {
    if (r.kind === 'blocks') {
      const items = r.blocks.map((b) => newBlock(b));
      upd((d) => insertAt(d, r.after, items));
      setSelId(items[0].id);
    } else if (r.kind === 'regen') updBlock(r.blockId, (b) => ({ name: r.name, content: r.content, minis: b.minis.length ? [] : b.minis }));
    else if (r.kind === 'split') updBlock(r.blockId, { minis: r.minis.map((text) => ({ id: uid(), text })) });
    else updBlock(r.blockId, (b) => ({ minis: b.minis.map((m) => (m.id === r.miniId ? { ...m, text: r.text } : m)) }));
  };

  const preview = (r: Res) => {
    if (r.kind === 'blocks')
      return (
        <>
          <p className="sum">{fmt(p.resNew, { n: r.blocks.length })}</p>
          <ol className="prev">
            {r.blocks.map((b, i) => (
              <li key={i}>
                <b>{b.name}</b> — {b.content.slice(0, 140)}
                {b.content.length > 140 ? '…' : ''}
              </li>
            ))}
          </ol>
        </>
      );
    if (r.kind === 'regen')
      return (
        <>
          <p className="sum serif">{r.name}</p>
          <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
            {r.content}
          </pre>
        </>
      );
    if (r.kind === 'split')
      return (
        <>
          <p className="sum">{fmt(p.resSplit, { n: r.minis.length })}</p>
          <ol className="prev">
            {r.minis.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ol>
        </>
      );
    return (
      <p className="sum">
        <span className="num" style={{ display: 'inline-flex', marginRight: 8 }}>
          {r.index + 1}
        </span>
        {r.text}
      </p>
    );
  };

  const blocked = mode === 'new' ? undefined : !editable ? p.pickBlock : !editable.content.trim() && mode === 'split' ? p.needText : undefined;
  const cta = mode === 'new' ? (count > 1 ? p.ctaNew : p.ctaNew1) : mode === 'regen' ? p.ctaRegen : p.ctaSplit;
  const onCount = doc.blocks.filter((b) => b.enabled).length;
  const countLine = `${doc.blocks.length} ${plural(doc.blocks.length, p.blocksForms)} · ${onCount} ${p.onWord}`;

  return (
    <div className="work">
      <aside className="panel side" aria-label={p.presetLabel}>
        <div className="listhead">
          {presets.length > 1 && (
            <select className="field mono" style={{ fontSize: 13 }} value={doc.id} onChange={(e) => setState({ presetId: e.target.value })} aria-label={p.presetLabel}>
              {presets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name || t.c.untitled}
                </option>
              ))}
            </select>
          )}
          <input className="field mono" style={{ fontSize: 13, padding: '8px 12px' }} value={doc.name} onChange={(e) => upd((d) => ({ ...d, name: e.target.value }))} aria-label={p.presetName} />
          <span className="count">{countLine}</span>
        </div>
        <div className="list">
          {doc.blocks.map((b) => (
            <div key={b.id} className="listrow">
              <button
                type="button"
                className={['blk', b.id === selId && 'sel', !b.enabled && 'off', b.marker && 'marker'].filter(Boolean).join(' ')}
                onClick={() => setSelId(b.id)}
                aria-pressed={b.id === selId}
              >
                {b.marker && (
                  <span className="ico">
                    <Pin size={14} />
                  </span>
                )}
                <span className="nm">{b.name || t.c.untitled}</span>
                {b.minis.length > 0 && (
                  <span className="minibadge">
                    {b.minis.length} {p.minisSuffix}
                  </span>
                )}
              </button>
              <Switch on={b.enabled} onChange={(v) => updBlock(b.id, { enabled: v })} label={`${b.enabled ? p.swOn : p.swOff}: ${b.name}`} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-dashed w100" onClick={addBlock}>
          <Plus size={16} />
          {p.addBlock}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          style={{ alignSelf: 'center', border: 0, background: 'transparent' }}
          onClick={() => {
            if (!confirmDelete(doc.name)) return;
            removeItem('presets', doc.id);
            setState({ presetId: '' });
          }}
        >
          <Trash size={14} />
          {p.deletePreset}
        </button>
      </aside>

      <section className="panel editor" aria-live="off">
        {!sel ? (
          <p className="well">{p.selectHint}</p>
        ) : (
          <>
            <BlockToolbar idx={selIdx} total={doc.blocks.length} onMove={move} onDup={sel.marker ? undefined : duplicate} onDelete={removeBlock} />
            {sel.marker ? (
              <MarkerView block={sel} />
            ) : (
              <BlockEditor
                key={sel.id}
                block={sel}
                onPatch={(patch) => updBlock(sel.id, patch)}
                onRegen={() => {
                  setMode('regen');
                  forgeRun('regen');
                }}
                onSplit={() => {
                  setMode('split');
                  forgeRun('split');
                }}
                onRegenMini={regenMini}
                onMinisToBlocks={minisToBlocks}
                busy={forge.busy}
              />
            )}
          </>
        )}
      </section>

      <Hearth
        sub={p.forgeSub}
        modes={
          <Modes
            label={t.h.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'new', label: p.modeNew },
              { id: 'regen', label: p.modeRegen },
              { id: 'split', label: p.modeSplit },
            ]}
          />
        }
        cta={cta}
        blocked={blocked}
        onForge={() => forgeRun()}
        forge={forge}
        preview={preview}
        onAccept={accept}
      >
        {mode === 'new' && (
          <Fld label={p.count} htmlFor="p-count">
            <NumInput id="p-count" value={count} min={1} max={20} onChange={setCount} />
            <p className="hint">{p.countHint}</p>
          </Fld>
        )}
        <StylePicker<PresetStyle> label={t.h.styleLabel} value={style} ids={PRESET_STYLES} names={t.styles.preset} onChange={(v) => setState({ presetStyle: v })} />
        <Fld label={t.h.ownLabel} htmlFor="p-instr">
          <textarea id="p-instr" className="field" rows={5} style={{ minHeight: 120, fontSize: 13, lineHeight: 1.6 }} placeholder={mode === 'new' ? p.ownPhNew : p.ownPh} value={instr} onChange={(e) => setInstr(e.target.value)} />
        </Fld>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {mode !== 'split' && (
            <label className="check">
              <input type="checkbox" checked={ctxOther} onChange={(e) => setCtxOther(e.target.checked)} />
              {p.ctxOther}
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={keepMacros} onChange={(e) => setKeepMacros(e.target.checked)} />
            {p.ctxMacros}
          </label>
        </div>
      </Hearth>
    </div>
  );
}

function BlockToolbar({ idx, total, onMove, onDup, onDelete }: { idx: number; total: number; onMove: (d: -1 | 1) => void; onDup?: () => void; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginBottom: -8 }}>
      <button type="button" className="iconbtn sm" onClick={() => onMove(-1)} disabled={idx <= 0} aria-label={t.c.moveUp} title={t.c.moveUp}>
        <Up size={16} />
      </button>
      <button type="button" className="iconbtn sm" onClick={() => onMove(1)} disabled={idx >= total - 1} aria-label={t.c.moveDown} title={t.c.moveDown}>
        <Down size={16} />
      </button>
      {onDup && (
        <button type="button" className="iconbtn sm" onClick={onDup} aria-label={t.p.duplicateBlock} title={t.p.duplicateBlock}>
          <Copy size={16} />
        </button>
      )}
      <button type="button" className="iconbtn sm" onClick={onDelete} aria-label={t.p.deleteBlock} title={t.p.deleteBlock}>
        <Trash size={16} />
      </button>
    </div>
  );
}

function MarkerView({ block }: { block: PresetBlock }) {
  const t = useT();
  const what = t.p.markers[block.identifier] ?? t.p.markerGeneric;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span className="kicker">{t.p.markerTitle}</span>
      <h2 className="serif" style={{ margin: 0, fontSize: 28, color: '#f7f2ec' }}>
        {block.name}
      </h2>
      <span className="mono hint">{block.identifier}</span>
      <p className="note plain">{fmt(t.p.markerNote, { what })}</p>
    </div>
  );
}

function BlockEditor({
  block,
  onPatch,
  onRegen,
  onSplit,
  onRegenMini,
  onMinisToBlocks,
  busy,
}: {
  block: PresetBlock;
  onPatch: (p: Partial<PresetBlock>) => void;
  onRegen: () => void;
  onSplit: () => void;
  onRegenMini: (i: number) => void;
  onMinisToBlocks: () => void;
  busy: boolean;
}) {
  const t = useT();
  const p = t.p;
  const minis = block.minis;
  const minisTokens = useMemo(() => minis.map((m) => m.text).join('\n'), [minis]);
  return (
    <>
      <div className="grid">
        <Fld label={p.blockName} htmlFor="blk-name" className="full">
          <input id="blk-name" className="field field-title" value={block.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </Fld>
        <Fld label={p.role} htmlFor="blk-role">
          <select id="blk-role" className="field" value={block.role} onChange={(e) => onPatch({ role: e.target.value as Role })}>
            <option value="system">System</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
        </Fld>
        <Fld label={p.position} htmlFor="blk-pos">
          <select id="blk-pos" className="field" value={block.position} onChange={(e) => onPatch({ position: Number(e.target.value) === 1 ? 1 : 0 })}>
            <option value={0}>{p.posRel}</option>
            <option value={1}>{p.posDepth}</option>
          </select>
        </Fld>
        {block.position === 1 && (
          <>
            <Fld label={p.depth} htmlFor="blk-depth">
              <NumInput id="blk-depth" value={block.depth} min={0} max={999} onChange={(v) => onPatch({ depth: v })} />
            </Fld>
            <Fld label={p.order} htmlFor="blk-order">
              <NumInput id="blk-order" value={block.order} min={0} max={9999} onChange={(v) => onPatch({ order: v })} />
            </Fld>
          </>
        )}
      </div>

      <Fld label={p.content} htmlFor="blk-content" extra={<Tok text={block.content} />}>
        <textarea id="blk-content" className="field mono" rows={8} style={{ minHeight: 170, fontSize: 13, lineHeight: 1.75 }} value={block.content} onChange={(e) => onPatch({ content: e.target.value })} />
      </Fld>

      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={onRegen} disabled={busy}>
          <Regen size={16} />
          {p.regenBlock}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSplit} disabled={busy || !block.content.trim()}>
          <Scissors size={16} />
          {p.splitBlock}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 20, borderTop: '1px dashed var(--line-2)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 22, color: '#f7f2ec' }}>
            {p.minisTitle}
          </h2>
          {minis.length > 0 ? <Tok text={minisTokens} /> : <span className="hint">{p.minisHint}</span>}
        </div>
        {minis.length > 0 ? (
          <>
            <p className="hint">{fmt(p.minisActive, { n: minis.length })}</p>
            <ol className="minis">
              {minis.map((m, i) => (
                <li key={m.id} className="mini">
                  <span className="num">{i + 1}</span>
                  <textarea
                    rows={Math.max(1, Math.ceil(m.text.length / 70))}
                    value={m.text}
                    placeholder={p.miniPh}
                    aria-label={`${p.minisTitle} ${i + 1}`}
                    onChange={(e) => onPatch({ minis: minis.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)) })}
                  />
                  <button type="button" className="iconbtn" aria-label={`${p.regenMini} ${i + 1}`} title={p.regenMini} disabled={busy} onClick={() => onRegenMini(i)}>
                    <Regen size={16} />
                  </button>
                  <button type="button" className="iconbtn" aria-label={`${p.delMini} ${i + 1}`} title={p.delMini} onClick={() => onPatch({ minis: minis.filter((x) => x.id !== m.id) })}>
                    <Trash size={16} />
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="well">{p.noMinis}</p>
        )}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-dashed" onClick={() => onPatch({ minis: [...minis, { id: uid(), text: '' }] })}>
            <Plus size={16} />
            {p.addMini}
          </button>
          {minis.length > 0 && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onMinisToBlocks}>
                <Split size={16} />
                {p.minisToBlocks}
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-danger" style={{ border: 0, background: 'transparent' }} onClick={() => onPatch({ minis: [] })}>
                {p.clearMinis}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
