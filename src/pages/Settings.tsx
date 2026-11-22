import { useState } from 'react';
import { Eye, Key } from '../components/Icons';
import { Fld, NumInput, PageHead, toast } from '../components/ui';
import { useT } from '../i18n';
import { DEFAULT_BASE, ENDPOINTS, complete, isConfigured, listModels, stProfiles } from '../lib/llm';
import { inST } from '../lib/st';
import { CHAR_STYLES, LORE_STYLES, PRESET_STYLES, type CharStyle, type LoreStyle, type PresetStyle } from '../lib/styles';
import { setConn, setState, useStore } from '../lib/store';
import type { Lang, ProviderKind } from '../lib/types';
import { fmt } from '../lib/util';

type Status = 'idle' | 'busy' | 'ok' | 'no' | 'err';

export function Settings() {
  const t = useT();
  const a = t.a;
  const s = useStore((x) => x);
  const conn = s.conn;
  const isST = conn.provider === 'st';
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState<Status>(s.verified ? 'ok' : 'idle');
  const [msg, setMsg] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const setProvider = (p: ProviderKind) => {
    if (p === 'st') {
      setConn({ provider: p });
      setModels([]);
      setStatus('idle');
      return;
    }
    const isDefault = !conn.baseUrl.trim() || Object.values(DEFAULT_BASE).includes(conn.baseUrl.trim().replace(/\/+$/, ''));
    setConn({ provider: p, baseUrl: isDefault ? DEFAULT_BASE[p] : conn.baseUrl });
    setModels([]);
    setStatus('idle');
  };

  const load = async () => {
    setLoadingModels(true);
    setMsg('');
    try {
      const list = await listModels(conn);
      setModels(list);
      toast(fmt(a.modelsFound, { n: list.length }));
      if (!conn.model && list[0]) setConn({ model: list[0] });
    } catch (e) {
      setMsg((e as Error).message);
      setStatus('err');
    } finally {
      setLoadingModels(false);
    }
  };

  const check = async () => {
    if (!isConfigured(conn)) {
      setStatus('no');
      setMsg('');
      return;
    }
    setStatus('busy');
    setMsg('');
    try {
      await complete(conn, [{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 64, noStream: true });
      setStatus('ok');
      setState({ verified: true });
    } catch (e) {
      setStatus('err');
      setMsg((e as Error).message);
    }
  };

  // A connection edit clears `verified`; drop a stale "connected" badge with it.
  const shownStatus: Status = status === 'ok' && !s.verified ? 'idle' : status;
  const statusText = { idle: a.stIdle, busy: a.checking, ok: a.stOk, no: a.stNo, err: msg }[shownStatus];
  const statusColor = shownStatus === 'ok' ? '#a9d8b4' : shownStatus === 'no' || shownStatus === 'err' ? '#f3b88f' : 'var(--text-3)';
  const dot = shownStatus === 'ok' ? 'var(--ok)' : shownStatus === 'no' || shownStatus === 'err' ? 'var(--fire)' : '#8a807a';

  return (
    <div className="page" style={{ gap: 28 }}>
      <PageHead kicker={a.kicker} title={a.title} sub={inST() ? a.subST : a.sub} />

      <div className="duo" style={{ gap: 24, alignItems: 'start' }}>
        <section className="panel" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 26, color: '#f7f2ec' }}>
            {a.connTitle}
          </h2>
          <Fld label={a.apiType} htmlFor="api-type">
            <select id="api-type" className="field" value={conn.provider} onChange={(e) => setProvider(e.target.value as ProviderKind)}>
              {(inST() || conn.provider === 'st') && <option value="st">{a.typeST}</option>}
              <option value="openai">{a.typeOai}</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </Fld>
          {isST ? (
            <STConn />
          ) : (
            <>
          <Fld label={a.endpoint} htmlFor="api-url">
            <input
              id="api-url"
              className="field mono"
              style={{ fontSize: 13 }}
              placeholder={DEFAULT_BASE[conn.provider]}
              value={conn.baseUrl}
              onChange={(e) => setConn({ baseUrl: e.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
            {conn.provider === 'openai' && (
              <div className="row" style={{ gap: 6 }}>
                <span className="hint">{a.quick}</span>
                {ENDPOINTS.map((ep) => (
                  <button key={ep.url} type="button" className="chip" onClick={() => setConn({ baseUrl: ep.url })} aria-pressed={conn.baseUrl === ep.url}>
                    {ep.label}
                  </button>
                ))}
              </div>
            )}
            <p className="hint">{a.endpointHint}</p>
          </Fld>
          <Fld label={a.key} htmlFor="api-key" extra={conn.provider === 'openai' ? <span className="hint">{a.keyOptional}</span> : undefined}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="api-key"
                className="field mono"
                style={{ fontSize: 13 }}
                type={shown ? 'text' : 'password'}
                placeholder="sk-…"
                value={conn.apiKey}
                onChange={(e) => setConn({ apiKey: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="iconbtn lg" onClick={() => setShown(!shown)} aria-label={shown ? a.hideKey : a.showKey} aria-pressed={shown} title={shown ? a.hideKey : a.showKey}>
                <Eye size={18} />
              </button>
            </div>
            <label className="check" title={a.rememberHint}>
              <input type="checkbox" checked={s.rememberKey} onChange={(e) => setState({ rememberKey: e.target.checked })} />
              {a.remember}
            </label>
          </Fld>
          <Fld label={a.model} htmlFor="api-model">
            <div className="row" style={{ gap: 8 }}>
              <input
                id="api-model"
                className="field mono"
                style={{ flex: '1 1 220px', width: 'auto', fontSize: 13 }}
                list="api-models"
                placeholder={a.modelPh}
                value={conn.model}
                onChange={(e) => setConn({ model: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
              <datalist id="api-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button type="button" className="btn btn-ghost" onClick={load} disabled={loadingModels}>
                {loadingModels ? a.loading : a.loadModels}
              </button>
            </div>
            {models.length > 0 && (
              <select className="field mono" style={{ fontSize: 13 }} value={models.includes(conn.model) ? conn.model : ''} onChange={(e) => setConn({ model: e.target.value })} aria-label={a.model}>
                <option value="" disabled>
                  {fmt(a.modelsFound, { n: models.length })}
                </option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Fld>
            </>
          )}
          <div className="row" style={{ gap: 12, paddingTop: 6 }}>
            <button type="button" className="btn btn-fire" onClick={check} disabled={status === 'busy'}>
              <Key size={16} />
              {a.checkBtn}
            </button>
            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: statusColor, flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>
              {status === 'busy' ? <span className="spin" /> : <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: dot }} />}
              {statusText}
            </span>
          </div>
          {msg && status !== 'err' && <p className="note">{msg}</p>}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section className="paper" style={{ borderRadius: '4px 4px 18px 18px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="lace-sm flip" />
            <div style={{ padding: '18px 28px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 22 }}>
                {a.privTitle}
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--paper-mute)', lineHeight: 1.6 }}>{a.privText}</p>
              <button
                type="button"
                className="btn btn-dark"
                style={{ alignSelf: 'flex-start', minHeight: 42 }}
                onClick={() => {
                  setConn({ apiKey: '' });
                  setStatus('idle');
                  toast(a.keyCleared);
                }}
              >
                {a.clearKey}
              </button>
            </div>
          </section>

          <section className="panel" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 26, color: '#f7f2ec' }}>
              {a.genTitle}
            </h2>
            {isST ? (
              <p className="hint">{a.stTempHint}</p>
            ) : (
              <Fld label={a.temp} htmlFor="api-temp" extra={<span className="mono" style={{ fontSize: 13, color: 'var(--cream)' }}>{conn.temperature.toFixed(2)}</span>}>
                <input id="api-temp" className="range" type="range" min={0} max={2} step={0.05} value={conn.temperature} onChange={(e) => setConn({ temperature: Number(e.target.value) })} />
              </Fld>
            )}
            <div className="grid sm">
              <Fld label={a.maxTok} htmlFor="api-max">
                <NumInput id="api-max" value={conn.maxTokens} min={64} max={200000} onChange={(v) => setConn({ maxTokens: v })} />
              </Fld>
              <Fld label={a.ctx} htmlFor="api-ctx">
                <NumInput id="api-ctx" value={s.ctxTokens} min={1024} max={2000000} onChange={(v) => setState({ ctxTokens: v })} />
              </Fld>
            </div>
            <p className="hint">{a.maxTokHint}</p>
            <label className="check">
              <input type="checkbox" checked={conn.stream} onChange={(e) => setConn({ stream: e.target.checked })} />
              {a.stream}
            </label>
          </section>
        </div>

        <section className="panel full" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 18, gridColumn: '1 / -1' }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 26, color: '#f7f2ec' }}>
            {a.defTitle}
          </h2>
          <div className="grid">
            <Fld label={a.defPreset} htmlFor="def-preset">
              <select id="def-preset" className="field" value={s.presetStyle} onChange={(e) => setState({ presetStyle: e.target.value as PresetStyle })}>
                {PRESET_STYLES.map((id) => (
                  <option key={id} value={id}>
                    {t.styles.preset[id].name}
                  </option>
                ))}
              </select>
            </Fld>
            <Fld label={a.defChar} htmlFor="def-char">
              <select id="def-char" className="field" value={s.charStyle} onChange={(e) => setState({ charStyle: e.target.value as CharStyle })}>
                {CHAR_STYLES.map((id) => (
                  <option key={id} value={id}>
                    {t.styles.char[id].name}
                  </option>
                ))}
              </select>
            </Fld>
            <Fld label={a.defLore} htmlFor="def-lore">
              <select id="def-lore" className="field" value={s.loreStyle} onChange={(e) => setState({ loreStyle: e.target.value as LoreStyle })}>
                {LORE_STYLES.map((id) => (
                  <option key={id} value={id}>
                    {t.styles.lore[id].name}
                  </option>
                ))}
              </select>
            </Fld>
            <Fld label={a.defOut} htmlFor="def-out">
              <select id="def-out" className="field" value={s.outLang} onChange={(e) => setState({ outLang: e.target.value as Lang })}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </Fld>
          </div>
          <Fld label={a.globalInstr} htmlFor="def-instr">
            <textarea id="def-instr" className="field" rows={4} style={{ fontSize: 14 }} placeholder={a.globalPh} value={s.globalInstr} onChange={(e) => setState({ globalInstr: e.target.value })} />
            <p className="hint">{a.globalHint}</p>
          </Fld>
        </section>
      </div>
    </div>
  );
}

/** Settings for generating through SillyTavern itself. */
function STConn() {
  const a = useT().a;
  const conn = useStore((x) => x.conn);
  const [profiles, setProfiles] = useState(stProfiles);
  const missing = !!conn.stProfile && !profiles.some((p) => p.id === conn.stProfile);
  return (
    <>
      <Fld label={a.stProfile} htmlFor="st-profile">
        <div className="row" style={{ gap: 8 }}>
          <select id="st-profile" className="field" style={{ flex: '1 1 220px', width: 'auto', minWidth: 0 }} value={conn.stProfile} onChange={(e) => setConn({ stProfile: e.target.value })}>
            <option value="">{a.stCurrent}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.model ? ` · ${p.model}` : ''}
              </option>
            ))}
            {missing && <option value={conn.stProfile}>{a.stMissing}</option>}
          </select>
          <button type="button" className="btn btn-ghost" onClick={() => setProfiles(stProfiles())}>
            {a.stRefresh}
          </button>
        </div>
        <p className="hint">{conn.stProfile ? a.stProfileHint : a.stCurrentHint}</p>
      </Fld>
      {!inST() && <p className="note">{a.stOutside}</p>}
    </>
  );
}
