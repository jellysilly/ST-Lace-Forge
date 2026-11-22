import { href } from '../App';
import { inST } from '../lib/st';
import { Arrow, Hammer, Key, Scissors } from '../components/Icons';
import { useT } from '../i18n';
import { CHAR_STYLES, LORE_STYLES, PRESET_STYLES } from '../lib/styles';
import { setState, useStore } from '../lib/store';
import { tokens } from '../lib/util';

const ROMAN = ['I', 'II', 'III', 'IV'];
const TOOL_ROUTES = ['presets', 'characters', 'lorebooks', 'plots'] as const;

function Ornament() {
  return (
    <div className="orn" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function Home() {
  const t = useT();
  const h = t.home;
  const instr = useStore((s) => s.globalInstr);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-txt">
          <div className="kick-line">{h.kicker}</div>
          <h1 className="serif">
            {h.heroTitle} <em>{h.heroTitle2}</em>
          </h1>
          <p className="hero-sub">{inST() ? h.heroSubST : h.heroSub}</p>
          <div className="row" style={{ gap: 12 }}>
            <a className="btn btn-fire btn-lg" href={href('presets')}>
              <Hammer size={18} />
              {h.cta1}
            </a>
            <a className="btn btn-ghost btn-lg" href="#guide">
              {h.cta2}
            </a>
          </div>
          <div className="compat">
            <span>{h.compat}</span>
            {['SillyTavern', 'Tavo AI', 'Character Card V2 / V3', 'PNG · JSON', 'World Info'].map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="panel demo" aria-hidden="true">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--mute)', letterSpacing: '.06em' }}>
                {h.demoFile}
              </span>
              <span className="serif" style={{ fontSize: 22, color: '#f7f2ec' }}>
                {h.demoBlock}
              </span>
            </div>
            <span className="fakesw" title={h.on}>
              <span />
            </span>
          </div>
          <p className="mono demo-long">{h.demoLong}</p>
          <div className="demo-split">
            <Scissors size={18} />
            {h.demoSplit}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {h.demoMinis.map((m, i) => (
              <div key={i} className="demo-mini">
                <span className="num">{i + 1}</span>
                <span>{m}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <Ornament />
          <h2 className="serif">{h.toolsTitle}</h2>
          <p>{h.toolsSub}</p>
        </div>
        <div className="tools">
          {h.tools.map((tool, i) => (
            <article key={i} className="tool paper">
              <div className="lace-sm flip" />
              <div className="tool-body">
                <div className="hd">
                  <h3 className="serif">{tool.title}</h3>
                  <span className="serif rn">{ROMAN[i]}</span>
                </div>
                <p>{tool.desc}</p>
                <ul>
                  {tool.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <a className="go" href={href(TOOL_ROUTES[i])}>
                  {tool.cta}
                  <Arrow size={16} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="duo">
        <div className="panel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="kicker">{h.stylesKicker}</span>
            <h2 className="serif">{h.stylesTitle}</h2>
            <p className="lead">{h.stylesSub}</p>
          </div>
          <div className="styles-list">
            <span className="cap">{h.forPresets}</span>
            {PRESET_STYLES.map((id) => (
              <div key={id} className="style-row">
                <span className="serif">{t.styles.preset[id].name}</span>
                <span>{t.styles.preset[id].desc}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="cap">{h.forChars}</span>
            <div className="row" style={{ gap: 8 }}>
              {CHAR_STYLES.map((id) => (
                <span key={id} className="chip" title={t.styles.char[id].desc}>
                  {t.styles.char[id].name}
                </span>
              ))}
            </div>
            <span className="cap" style={{ paddingTop: 6 }}>
              {h.forLore}
            </span>
            <div className="row" style={{ gap: 8 }}>
              {LORE_STYLES.map((id) => (
                <span key={id} className="chip" title={t.styles.lore[id].desc}>
                  {t.styles.lore[id].name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="kicker">{h.ownKicker}</span>
            <h2 className="serif">{h.ownTitle}</h2>
            <p className="lead">{h.ownSub}</p>
          </div>
          <div className="fld" style={{ flex: 1, gap: 8 }}>
            <label htmlFor="own-global" style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
              {h.ownLabel}
            </label>
            <textarea
              id="own-global"
              className="field mono"
              rows={7}
              style={{ flex: 1, minHeight: 190, fontSize: 13, lineHeight: 1.7, borderRadius: 14, padding: 16 }}
              placeholder={h.ownPlaceholder}
              value={instr}
              onChange={(e) => setState({ globalInstr: e.target.value })}
            />
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, color: 'var(--mute)' }}>
              <span>{h.ownHint}</span>
              <span className="mono">~ {tokens(instr)} tok</span>
            </div>
          </div>
        </div>
      </section>

      <section id="guide" className="sec" style={{ scrollMarginTop: 24 }}>
        <div className="sec-head">
          <Ornament />
          <h2 className="serif">{h.guideTitle}</h2>
          <p>{h.guideSub}</p>
        </div>
        <ol className="steps">
          {h.steps.map((st, i) => (
            <li key={i} className="step">
              <div className="n-row">
                <span className="n">{i + 1}</span>
              </div>
              <h3 className="serif">{st.title}</h3>
              <p>{st.text}</p>
            </li>
          ))}
        </ol>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <a className="btn btn-fire btn-lg" href={href('settings')}>
            <Key size={18} />
            {h.guideCta}
          </a>
        </div>
      </section>
    </div>
  );
}
