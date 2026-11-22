import { useState, type ReactNode } from 'react';
import { go, href } from '../App';
import { Hearth } from '../components/Hearth';
import { Book, Copy, Down, Hammer, Plus, Regen, Trash, Up, Upload, X } from '../components/Icons';
import { Fld, Modes, NsfwSwitch, NumInput, PageHead, TextFld, confirmDelete, toast } from '../components/ui';
import { useT } from '../i18n';
import { isObj } from '../lib/json';
import {
  NSFW_GENRES,
  PLOT_FIELDS,
  PLOT_GENRES,
  PLOT_TONES,
  emptyPlot,
  emptyPlotParts,
  isNsfwGenre,
  newBeat,
  parseBeats,
  parseIdeas,
  plotPatch,
  plotToCard,
  plotToMarkdown,
  textOf,
  type PlotField,
  type PlotGenre,
  type PlotLabels,
  type PlotPart,
} from '../lib/plot';
import { plotField, plotFill, plotIdeas, plotMore, plotNew, type Common, type PlotCtx, type PlotOpts } from '../lib/prompts';
import { getState, patchItem, removeItem, setState, upsert, useStore } from '../lib/store';
import type { PlotBeat, PlotDoc, PlotIdea } from '../lib/types';
import { useForge } from '../lib/useForge';
import { download, fmt, plural, slugify, splitList, tokens } from '../lib/util';

type Tab = 'ideas' | 'plots';

/** Library items picked as context; shared by both tabs. */
interface Picks {
  charId: string;
  personaId: string;
  bookId: string;
}

const DEFAULT_BEATS = 6;

const commonOf = (instr: string): Common => {
  const s = getState();
  return { outLang: s.outLang, globalInstr: s.globalInstr, instr };
};

const optsOf = (): PlotOpts => {
  const s = getState();
  return { genres: s.plotGenres, tone: s.plotTone, nsfw: s.nsfw };
};

const ctxOf = (p: Picks): PlotCtx => {
  const s = getState();
  return { character: s.characters.find((x) => x.id === p.charId), persona: s.personas.find((x) => x.id === p.personaId), book: s.lorebooks.find((x) => x.id === p.bookId) };
};

const plotTokens = (beats: number) => Math.max(getState().conn.maxTokens, 2500 + beats * 350);

function newPlotFrom(json: unknown, nsfw: boolean, fallbackTitle: string): PlotDoc | null {
  const patch = plotPatch(json, ['title', 'tags', ...PLOT_FIELDS, 'beats']);
  if (!patch.synopsis && !patch.beats && !patch.opening) return null;
  return { ...emptyPlot(), ...patch, title: patch.title || fallbackTitle, nsfw };
}

const plotText = (p: PlotDoc) => [p.title, p.logline, p.setting, p.cast, p.synopsis, p.twists, p.opening, ...p.beats.map((b) => b.title + b.text)].join('');

export function Plots() {
  const t = useT();
  const pl = t.pl;
  const [tab, setTab] = useState<Tab>('ideas');
  const [picks, setPicks] = useState<Picks>({ charId: '', personaId: '', bookId: '' });
  return (
    <div className="page">
      <PageHead kicker={pl.kicker} title={pl.title}>
        <NsfwSwitch />
        <div role="group" aria-label={pl.tabsLabel} className="segs" style={{ padding: 3 }}>
          {(['ideas', 'plots'] as const).map((id) => (
            <button key={id} type="button" className={tab === id ? 'tab on' : 'tab'} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {id === 'ideas' ? pl.tabIdeas : pl.tabPlots}
            </button>
          ))}
        </div>
      </PageHead>
      {tab === 'ideas' ? <IdeasWork picks={picks} setPicks={setPicks} onPlot={() => setTab('plots')} /> : <PlotWork picks={picks} setPicks={setPicks} />}
    </div>
  );
}

/* ───────── shared bits ───────── */

const Badge18 = () => <span className="b18">18+</span>;

/** Genres, tone, library context and the own instruction — the same in both hearths. */
function PlotControls({ picks, setPicks, instr, setInstr, prefix }: { picks: Picks; setPicks: (p: Picks) => void; instr: string; setInstr: (v: string) => void; prefix: string }) {
  const t = useT();
  const pl = t.pl;
  const nsfw = useStore((s) => s.nsfw);
  const genres = useStore((s) => s.plotGenres);
  const tone = useStore((s) => s.plotTone);
  const chars = useStore((s) => s.characters);
  const personas = useStore((s) => s.personas);
  const books = useStore((s) => s.lorebooks);
  const shown: PlotGenre[] = nsfw ? [...PLOT_GENRES, ...NSFW_GENRES] : [...PLOT_GENRES];
  const active = genres.filter((g) => shown.includes(g));
  const toggle = (g: PlotGenre) => setState((s) => ({ plotGenres: s.plotGenres.includes(g) ? s.plotGenres.filter((x) => x !== g) : [...s.plotGenres, g] }));
  // Always shown, even with an empty library, so the character slot is never missing.
  const pickSelect = (id: string, label: string, value: string, items: { id: string; name: string }[], key: keyof Picks) => (
    <Fld label={label} htmlFor={id}>
      <select id={id} className="field" disabled={!items.length} value={items.some((x) => x.id === value) ? value : ''} onChange={(e) => setPicks({ ...picks, [key]: e.target.value })}>
        <option value="">{items.length ? pl.ctxNone : pl.ctxEmpty}</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name || t.c.untitled}
          </option>
        ))}
      </select>
    </Fld>
  );

  return (
    <>
      <div className="fld" role="group" aria-label={pl.genresLabel}>
        <div className="fld-head">
          <span className="label">{pl.genresLabel}</span>
          {active.length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ minHeight: 30 }} onClick={() => setState({ plotGenres: [] })}>
              {pl.anyGenre}
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {shown.map((g) => {
            const on = genres.includes(g);
            return (
              <button key={g} type="button" className={['chip pick', on && 'on', isNsfwGenre(g) && 'adult'].filter(Boolean).join(' ')} aria-pressed={on} onClick={() => toggle(g)}>
                {pl.genres[g]}
              </button>
            );
          })}
        </div>
        {!active.length && <p className="hint">{pl.genresHint}</p>}
      </div>
      <div className="fld" role="group" aria-label={pl.toneLabel}>
        <span className="label">{pl.toneLabel}</span>
        <div className="row" style={{ gap: 6 }}>
          {PLOT_TONES.map((id) => (
            <button key={id} type="button" className={tone === id ? 'chip pick on' : 'chip pick'} aria-pressed={tone === id} onClick={() => setState({ plotTone: id })}>
              {pl.tones[id]}
            </button>
          ))}
        </div>
      </div>
      <div className="fld" role="group" aria-label={pl.ctxLabel}>
        <span className="label">{pl.ctxLabel}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pickSelect(prefix + '-char', pl.ctxChar, picks.charId, chars, 'charId')}
          {pickSelect(prefix + '-per', pl.ctxPer, picks.personaId, personas, 'personaId')}
          {pickSelect(prefix + '-book', pl.ctxBook, picks.bookId, books, 'bookId')}
        </div>
        {(!chars.length || !personas.length || !books.length) && (
          <p className="hint">
            {pl.ctxAdd} <a href={href('characters')}>{t.c.navChars}</a> · <a href={href('lorebooks')}>{t.c.navLore}</a>
          </p>
        )}
      </div>
      <p className={nsfw ? 'note' : 'note plain'}>{nsfw ? pl.nsfwOn : pl.nsfwOff}</p>
      <Fld label={t.h.ownLabel} htmlFor={prefix + '-instr'}>
        <textarea id={prefix + '-instr'} className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={pl.ownPh} value={instr} onChange={(e) => setInstr(e.target.value)} />
      </Fld>
    </>
  );
}

function PlotPreview({ plot, labels }: { plot: PlotDoc; labels: PlotLabels }) {
  const t = useT();
  return (
    <>
      <p className="sum serif">
        {plot.title} {plot.nsfw && <Badge18 />}
      </p>
      <p className="sum">{fmt(t.pl.resBeats, { n: plot.beats.length })}</p>
      <ul className="prev">
        {PLOT_FIELDS.filter((f) => plot[f].trim()).map((f) => (
          <li key={f}>
            <b>{labels.fields[f]}</b> — {plot[f].slice(0, 160)}
            {plot[f].length > 160 ? '…' : ''}
          </li>
        ))}
      </ul>
    </>
  );
}

const usePlotLabels = (): PlotLabels => {
  const pl = useT().pl;
  return { tags: pl.tags, fields: pl.fields, beats: pl.beats };
};

/* ───────── ideas ───────── */

type IdeaRes = { kind: 'ideas'; ideas: PlotIdea[] } | { kind: 'plot'; ideaId: string; plot: PlotDoc };

function IdeasWork({ picks, setPicks, onPlot }: { picks: Picks; setPicks: (p: Picks) => void; onPlot: () => void }) {
  const t = useT();
  const pl = t.pl;
  const labels = usePlotLabels();
  const ideas = useStore((s) => s.ideas);
  const [seed, setSeed] = useState('');
  const [count, setCount] = useState(6);
  const [instr, setInstr] = useState('');
  const [expanding, setExpanding] = useState('');
  const forge = useForge<IdeaRes>();

  const forgeIdeas = () => {
    const o = optsOf();
    setExpanding('');
    const avoid = ideas.slice(0, 30).map((i) => i.title || i.logline.slice(0, 80));
    forge.run(
      plotIdeas(seed, count, avoid, o, ctxOf(picks), commonOf(instr)),
      (json) => {
        const list = parseIdeas(json, o.nsfw);
        return list.length ? { kind: 'ideas', ideas: list } : null;
      },
      { maxTokens: Math.max(getState().conn.maxTokens, count * 250) },
    );
  };

  const expand = (idea: PlotIdea) => {
    const o = optsOf();
    setExpanding(idea.id);
    const text = [idea.title, idea.logline, idea.tags.length ? `(${idea.tags.join(', ')})` : ''].filter(Boolean).join('\n');
    forge.run(
      plotNew(text, DEFAULT_BEATS, o, ctxOf(picks), commonOf(instr)),
      (json) => {
        const plot = newPlotFrom(json, o.nsfw, idea.title || pl.newPlot);
        return plot ? { kind: 'plot', ideaId: idea.id, plot } : null;
      },
      { maxTokens: plotTokens(DEFAULT_BEATS) },
    );
  };

  const accept = (r: IdeaRes) => {
    if (r.kind === 'ideas') setState((s) => ({ ideas: [...r.ideas, ...s.ideas] }));
    else {
      upsert('plots', r.plot);
      setState({ plotId: r.plot.id });
      onPlot();
    }
  };

  const preview = (r: IdeaRes): ReactNode =>
    r.kind === 'plot' ? (
      <PlotPreview plot={r.plot} labels={labels} />
    ) : (
      <>
        <p className="sum">{fmt(pl.resIdeas, { n: r.ideas.length })}</p>
        <ol className="prev">
          {r.ideas.map((i) => (
            <li key={i.id}>
              <b>{i.title}</b> — {i.logline}
            </li>
          ))}
        </ol>
      </>
    );

  const hotId = forge.busy || forge.result?.kind === 'plot' ? expanding : '';

  return (
    <div className="work">
      <section className="panel editor">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 26, color: '#f7f2ec' }}>
            {pl.boardTitle} <span className="tokn">{ideas.length || ''}</span>
          </h2>
          {ideas.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              style={{ background: 'transparent', color: 'var(--mute)' }}
              onClick={() => window.confirm(pl.confirmClear) && setState({ ideas: [] })}
            >
              <Trash size={14} />
              {pl.clearBoard}
            </button>
          )}
        </div>
        {!ideas.length ? (
          <p className="well">{pl.boardEmpty}</p>
        ) : (
          <ul className="ideas">
            {ideas.map((i) => (
              <li key={i.id} className={i.id === hotId ? 'idea hot' : 'idea'}>
                <div className="idea-head">
                  <h3 className="serif">{i.title || t.c.untitled}</h3>
                  {i.nsfw && <Badge18 />}
                  <button type="button" className="iconbtn sm" aria-label={`${pl.deleteIdea}: ${i.title}`} title={pl.deleteIdea} onClick={() => setState((s) => ({ ideas: s.ideas.filter((x) => x.id !== i.id) }))}>
                    <X size={14} />
                  </button>
                </div>
                <p>{i.logline}</p>
                {i.tags.length > 0 && (
                  <div className="tagline">
                    {i.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button type="button" className="btn btn-ghost btn-sm" disabled={forge.busy} onClick={() => expand(i)}>
                  <Hammer size={14} />
                  {pl.expand}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Hearth sub={pl.ideasSub} cta={pl.ctaIdeas} onForge={forgeIdeas} forge={forge} preview={preview} onAccept={accept}>
        {hotId && <p className="hint">{pl.expandNote}</p>}
        <Fld label={pl.seedLabel} htmlFor="pi-seed">
          <textarea id="pi-seed" className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={pl.seedPh} value={seed} onChange={(e) => setSeed(e.target.value)} />
        </Fld>
        <Fld label={pl.count} htmlFor="pi-count">
          <NumInput id="pi-count" value={count} min={1} max={20} onChange={setCount} />
        </Fld>
        <PlotControls picks={picks} setPicks={setPicks} instr={instr} setInstr={setInstr} prefix="pi" />
      </Hearth>
    </div>
  );
}

/* ───────── plots ───────── */

type PlotMode = 'new' | 'fill' | 'field' | 'more';
type Target = PlotField | 'beats';
type PlotRes =
  | { kind: 'new'; plot: PlotDoc }
  | { kind: 'fill'; id: string; patch: Partial<PlotDoc> }
  | { kind: 'field'; id: string; field: PlotField; value: string; nsfw: boolean }
  | { kind: 'beats'; id: string; beats: PlotBeat[]; append: boolean; nsfw: boolean };

const TEXT_ROWS: Record<PlotField, number> = { logline: 2, setting: 5, cast: 5, synopsis: 6, twists: 4, opening: 6 };

function PlotWork({ picks, setPicks }: { picks: Picks; setPicks: (p: Picks) => void }) {
  const t = useT();
  const pl = t.pl;
  const labels = usePlotLabels();
  const list = useStore((s) => s.plots);
  const plotId = useStore((s) => s.plotId);
  const cur = list.find((x) => x.id === plotId) ?? list[0];
  const [mode, setMode] = useState<PlotMode>('new');
  const [hot, setHot] = useState<Target>('synopsis');
  const [seed, setSeed] = useState('');
  const [beats, setBeats] = useState(DEFAULT_BEATS);
  const [more, setMore] = useState(3);
  const [instr, setInstr] = useState('');
  const forge = useForge<PlotRes>();

  const upd = (fn: (p: PlotDoc) => PlotDoc) => cur && patchItem('plots', cur.id, fn);
  const updBeat = (id: string, patch: Partial<PlotBeat>) => upd((p) => ({ ...p, beats: p.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const moveBeat = (i: number, dir: -1 | 1) =>
    upd((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.beats.length) return p;
      const next = [...p.beats];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...p, beats: next };
    });

  const createNew = () => {
    const p = emptyPlot(pl.newPlot);
    upsert('plots', p);
    setState({ plotId: p.id });
  };

  const partName = (k: PlotPart) => (k === 'title' ? pl.plotTitle : k === 'tags' ? pl.tags : k === 'beats' ? pl.beats : pl.fields[k]);

  /* AI */
  const missing = cur ? emptyPlotParts(cur) : [];
  const forgeRun = (m: PlotMode = mode, target: Target = hot) => {
    const o = optsOf();
    const ctx = ctxOf(picks);
    const c = commonOf(instr);
    const beatsOf = (json: unknown) => parseBeats(isObj(json) ? (json.beats ?? json.scenes) : json);
    if (m === 'new') {
      forge.run(
        plotNew(seed, beats, o, ctx, c),
        (json) => {
          const plot = newPlotFrom(json, o.nsfw, pl.newPlot);
          return plot ? { kind: 'new', plot } : null;
        },
        { maxTokens: plotTokens(beats) },
      );
    } else if (!cur) return;
    else if (m === 'fill') {
      const keys = emptyPlotParts(cur);
      forge.run(
        plotFill(cur, keys, seed, beats, o, ctx, c),
        (json) => {
          const patch = plotPatch(json, keys);
          return Object.keys(patch).length ? { kind: 'fill', id: cur.id, patch: { ...patch, nsfw: cur.nsfw || o.nsfw } } : null;
        },
        { maxTokens: plotTokens(keys.includes('beats') ? beats : 0) },
      );
    } else if (m === 'more') {
      forge.run(
        plotMore(cur, more, seed, o, ctx, c),
        (json) => {
          const b = beatsOf(json);
          return b.length ? { kind: 'beats', id: cur.id, beats: b, append: true, nsfw: o.nsfw } : null;
        },
        { maxTokens: Math.max(getState().conn.maxTokens, more * 400) },
      );
    } else if (target === 'beats') {
      forge.run(
        plotField(cur, 'beats', seed, beats, o, ctx, c),
        (json) => {
          const b = beatsOf(json);
          return b.length ? { kind: 'beats', id: cur.id, beats: b, append: false, nsfw: o.nsfw } : null;
        },
        { maxTokens: plotTokens(cur.beats.length || beats) },
      );
    } else {
      const make = (value: string): PlotRes | null => (value.trim() ? { kind: 'field', id: cur.id, field: target, value, nsfw: o.nsfw } : null);
      forge.run(plotField(cur, target, seed, beats, o, ctx, c), (json) => make(isObj(json) ? textOf(json.value ?? json[target] ?? json.text) : textOf(json)), { plain: make });
    }
  };

  const accept = (r: PlotRes) => {
    if (r.kind === 'new') {
      upsert('plots', r.plot);
      setState({ plotId: r.plot.id });
    } else if (r.kind === 'fill') patchItem('plots', r.id, (p) => ({ ...p, ...r.patch }));
    else if (r.kind === 'field') patchItem('plots', r.id, (p) => ({ ...p, [r.field]: r.value, nsfw: p.nsfw || r.nsfw }));
    else patchItem('plots', r.id, (p) => ({ ...p, beats: r.append ? [...p.beats, ...r.beats] : r.beats, nsfw: p.nsfw || r.nsfw }));
  };

  const preview = (r: PlotRes): ReactNode => {
    if (r.kind === 'new') return <PlotPreview plot={r.plot} labels={labels} />;
    if (r.kind === 'field')
      return (
        <pre className="stream" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
          {r.value}
        </pre>
      );
    if (r.kind === 'beats')
      return (
        <>
          <p className="sum">{fmt(pl.resBeats, { n: r.beats.length })}</p>
          <ol className="prev" start={r.append && cur ? cur.beats.length + 1 : 1}>
            {r.beats.map((b) => (
              <li key={b.id}>
                {b.title && <b>{b.title} — </b>}
                {b.text}
              </li>
            ))}
          </ol>
        </>
      );
    const keys = Object.keys(r.patch).filter((k) => k !== 'nsfw') as PlotPart[];
    return (
      <>
        <p className="sum">{fmt(pl.resParts, { n: keys.length })}</p>
        <ul className="prev">
          {keys.map((k) => {
            const v = k === 'beats' ? (r.patch.beats ?? []).map((b, i) => `${i + 1}. ${b.title}`).join('; ') : k === 'tags' ? (r.patch.tags ?? []).join(', ') : String(r.patch[k] ?? '');
            return (
              <li key={k}>
                <b>{partName(k)}</b> — {v.slice(0, 160)}
                {v.length > 160 ? '…' : ''}
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  // ↻ next to a part reforges it right away, using the idea and instruction typed in the hearth.
  const target = (f: Target) => {
    setHot(f);
    setMode('field');
    if (!forge.busy) forgeRun('field', f);
  };

  const blocked = mode !== 'new' && !cur ? pl.emptyLib : mode === 'fill' && !missing.length ? pl.fillNone : undefined;
  const cta = { new: pl.ctaNew, fill: pl.ctaFill, field: pl.ctaField, more: pl.ctaMore }[mode];

  const exportMd = () => {
    if (!cur) return;
    const name = `${slugify(cur.title, 'plot')}.md`;
    download(name, plotToMarkdown(cur, labels), 'text/markdown');
    toast(fmt(t.c.exported, { name }));
  };

  const copy = async () => {
    if (!cur) return;
    try {
      await navigator.clipboard.writeText(plotToMarkdown(cur, labels));
      toast(pl.copied);
    } catch {
      toast(pl.copyFail, true);
    }
  };

  const toCard = () => {
    if (!cur) return;
    const card = plotToCard(cur, labels);
    upsert('characters', card);
    setState({ charId: card.id });
    toast(fmt(pl.cardMade, { name: card.name || t.c.untitled }));
    go(href('characters'));
  };

  return (
    <div className="work">
      <aside className="panel side" aria-label={pl.libTitle}>
        <span className="label" style={{ padding: '0 8px' }}>
          {pl.libTitle}
        </span>
        <div className="list">
          {list.length === 0 && <p className="hint" style={{ padding: '0 8px' }}>{pl.emptyLib}</p>}
          {list.map((p) => (
            <button key={p.id} type="button" className={p.id === cur?.id ? 'entry sel' : 'entry'} aria-pressed={p.id === cur?.id} onClick={() => setState({ plotId: p.id })}>
              <span className="top">
                <span className="t">{p.title || t.c.untitled}</span>
                {p.nsfw && <Badge18 />}
              </span>
              <span className="keys">
                {p.beats.length} {plural(p.beats.length, pl.beatsForms)} · ~{tokens(plotText(p))} {t.c.tok}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-dashed w100" onClick={createNew}>
          <Plus size={16} />
          {pl.newPlot}
        </button>
      </aside>

      <section className="panel editor">
        {!cur ? (
          <p className="well">{pl.emptyLib}</p>
        ) : (
          <>
            <Fld label={pl.plotTitle} htmlFor="pl-title" extra={cur.nsfw ? <Badge18 /> : undefined}>
              <input id="pl-title" className="field serif" style={{ fontSize: 22 }} value={cur.title} onChange={(e) => upd((p) => ({ ...p, title: e.target.value }))} />
            </Fld>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={exportMd}>
                <Upload size={14} />
                {pl.exportMd}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                <Copy size={14} />
                {pl.copy}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(`${href('characters')}?greet=${cur.id}`)} title={pl.toGreetingHint}>
                <Book size={14} />
                {pl.toGreeting}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={toCard} title={pl.toCardHint}>
                <Plus size={14} />
                {pl.toCard}
              </button>
              <span className="tokn" style={{ marginLeft: 'auto' }}>
                {pl.total}: ~{tokens(plotText(cur))} {t.c.tok}
              </span>
            </div>

            <TextFld id="pl-logline" label={pl.fields.logline} rows={TEXT_ROWS.logline} value={cur.logline} onChange={(v) => upd((p) => ({ ...p, logline: v }))} hot={mode === 'field' && hot === 'logline'} onTarget={() => target('logline')} regenLabel={pl.regenPart} />
            <Fld label={pl.tags} htmlFor="pl-tags">
              <input id="pl-tags" className="field" placeholder={pl.tagsPh} defaultValue={cur.tags.join(', ')} key={cur.id + cur.tags.join()} onBlur={(e) => upd((p) => ({ ...p, tags: splitList(e.target.value) }))} />
            </Fld>
            {(['setting', 'cast', 'synopsis'] as const).map((f) => (
              <TextFld key={f} id={'pl-' + f} label={pl.fields[f]} rows={TEXT_ROWS[f]} value={cur[f]} onChange={(v) => upd((p) => ({ ...p, [f]: v }))} hot={mode === 'field' && hot === f} onTarget={() => target(f)} regenLabel={pl.regenPart} />
            ))}

            <div className="fld">
              <div className="fld-head">
                <span className="label">{pl.beats}</span>
                <div className="meta">
                  <span className="tokn">{cur.beats.length}</span>
                  <button type="button" className={mode === 'field' && hot === 'beats' ? 'iconbtn hot' : 'iconbtn'} onClick={() => target('beats')} aria-label={`${pl.regenPart}: ${pl.beats}`} aria-pressed={mode === 'field' && hot === 'beats'} title={pl.regenPart}>
                    <Regen size={16} />
                  </button>
                </div>
              </div>
              <p className="hint">{pl.beatsHint}</p>
              {cur.beats.length === 0 ? (
                <p className="well">{pl.noBeats}</p>
              ) : (
                <ol className="beats">
                  {cur.beats.map((b, i) => (
                    <li key={b.id} className="beat">
                      <span className="num">{i + 1}</span>
                      <div className="beat-body">
                        <input className="serif" aria-label={fmt(pl.beatN, { n: i + 1 })} placeholder={pl.beatTitlePh} value={b.title} onChange={(e) => updBeat(b.id, { title: e.target.value })} />
                        <textarea aria-label={`${fmt(pl.beatN, { n: i + 1 })}: ${b.title}`} placeholder={pl.beatTextPh} value={b.text} onChange={(e) => updBeat(b.id, { text: e.target.value })} />
                      </div>
                      <div className="beat-tools">
                        <button type="button" className="iconbtn sm" aria-label={t.c.moveUp} title={t.c.moveUp} disabled={i === 0} onClick={() => moveBeat(i, -1)}>
                          <Up size={14} />
                        </button>
                        <button type="button" className="iconbtn sm" aria-label={t.c.moveDown} title={t.c.moveDown} disabled={i === cur.beats.length - 1} onClick={() => moveBeat(i, 1)}>
                          <Down size={14} />
                        </button>
                        <button type="button" className="iconbtn sm" aria-label={pl.delBeat} title={pl.delBeat} onClick={() => upd((p) => ({ ...p, beats: p.beats.filter((x) => x.id !== b.id) }))}>
                          <X size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <button type="button" className="btn btn-ghost btn-dashed btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => upd((p) => ({ ...p, beats: [...p.beats, newBeat()] }))}>
                <Plus size={14} />
                {pl.addBeat}
              </button>
            </div>

            {(['twists', 'opening'] as const).map((f) => (
              <TextFld key={f} id={'pl-' + f} label={pl.fields[f]} rows={TEXT_ROWS[f]} value={cur[f]} onChange={(v) => upd((p) => ({ ...p, [f]: v }))} hot={mode === 'field' && hot === f} onTarget={() => target(f)} regenLabel={pl.regenPart} />
            ))}

            <button
              type="button"
              className="btn btn-sm btn-danger"
              style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--mute)' }}
              onClick={() => {
                if (!confirmDelete(cur.title)) return;
                removeItem('plots', cur.id);
                setState({ plotId: '' });
              }}
            >
              <Trash size={14} />
              {pl.deletePlot}
            </button>
          </>
        )}
      </section>

      <Hearth
        sub={pl.plotsSub}
        modes={
          <Modes
            label={t.h.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'new', label: pl.modeNew },
              { id: 'fill', label: pl.modeFill },
              { id: 'field', label: pl.modeField },
              { id: 'more', label: pl.modeMore },
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
        {mode === 'new' && <p className="hint">{pl.newNote}</p>}
        {mode === 'fill' && missing.length > 0 && <p className="hint">{fmt(pl.fillNote, { list: missing.map(partName).join(', ') })}</p>}
        {mode === 'more' && <p className="hint">{pl.moreNote}</p>}
        {mode === 'field' && (
          <>
            <p className="note">{fmt(pl.fieldNote, { f: partName(hot) })}</p>
            <Fld label={pl.partLabel} htmlFor="pl-part">
              <select id="pl-part" className="field" value={hot} onChange={(e) => setHot(e.target.value as Target)}>
                {[...PLOT_FIELDS.slice(0, 4), 'beats' as const, ...PLOT_FIELDS.slice(4)].map((f) => (
                  <option key={f} value={f}>
                    {partName(f)}
                  </option>
                ))}
              </select>
            </Fld>
          </>
        )}
        <Fld label={mode === 'new' ? pl.ideaLabel : mode === 'more' ? pl.moreLabel : pl.extraLabel} htmlFor="pl-seed">
          <textarea id="pl-seed" className="field" rows={3} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder={mode === 'new' ? pl.ideaPh : ''} value={seed} onChange={(e) => setSeed(e.target.value)} />
        </Fld>
        {(mode === 'new' || (mode === 'fill' && missing.includes('beats'))) && (
          <Fld label={pl.beatsCount} htmlFor="pl-beats">
            <NumInput id="pl-beats" value={beats} min={3} max={15} onChange={setBeats} />
          </Fld>
        )}
        {mode === 'more' && (
          <Fld label={pl.moreCount} htmlFor="pl-more">
            <NumInput id="pl-more" value={more} min={1} max={10} onChange={setMore} />
          </Fld>
        )}
        <PlotControls picks={picks} setPicks={setPicks} instr={instr} setInstr={setInstr} prefix="pl" />
      </Hearth>
    </div>
  );
}
