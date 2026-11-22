import { useEffect, useState } from 'react';
import { Toasts } from './components/ui';
import { Logo, SocialIcon, X } from './components/Icons';
import { AUTHOR, activeSocials } from './config';
import { useT } from './i18n';
import { isConfigured, stLabel } from './lib/llm';
import { closeST, inST } from './lib/st';
import { setState, useStore } from './lib/store';
import { fmt } from './lib/util';
import { Characters } from './pages/Characters';
import { Home } from './pages/Home';
import { Lorebooks } from './pages/Lorebooks';
import { Plots } from './pages/Plots';
import { Presets } from './pages/Presets';
import { Settings } from './pages/Settings';

export type Route = 'home' | 'presets' | 'characters' | 'lorebooks' | 'plots' | 'settings';
const ROUTES: Route[] = ['home', 'presets', 'characters', 'lorebooks', 'plots', 'settings'];

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route;
  return ROUTES.includes(h) ? h : 'home';
}

export const href = (r: Route) => (r === 'home' ? '#/' : '#/' + r);

/**
 * Goes to an in-app hash. Inside SillyTavern the hash is replaced instead of pushed: the iframe
 * would otherwise fill the tab history, and the phone's Back button must close the Forge.
 */
export function go(hash: string) {
  if (inST()) location.replace(hash);
  else location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const t = useT();
  const lang = useStore((s) => s.lang);

  useEffect(() => {
    const onHash = () => {
      // In-page anchors (#guide) are not routes.
      if (!location.hash.startsWith('#/') && location.hash.length > 1) return;
      setRoute(readRoute());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!inST()) return;
    document.documentElement.classList.add('in-st');
    // Route links replace the hash instead of pushing history entries (see go()).
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      const h = a?.getAttribute('href');
      if (!h || !h.startsWith('#/') || a?.target) return;
      e.preventDefault();
      go(h);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.stpick')) return;
      closeST();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    const names: Record<Route, string> = { home: '', presets: t.c.navPresets, characters: t.c.navChars, lorebooks: t.c.navLore, plots: t.c.navPlots, settings: t.c.apiTitle };
    document.title = names[route] ? `${names[route]} · ${t.c.brand}` : t.c.brand;
  }, [route, lang, t]);

  const wide = route === 'presets' || route === 'characters' || route === 'lorebooks' || route === 'plots';

  return (
    <div className="lf">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        {t.c.skip}
      </a>
      <div className="lace" />
      <Header route={route} wide={wide} />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <div className={wide ? 'wrap wide' : 'wrap'}>
          {route === 'home' && <Home />}
          {route === 'presets' && <Presets />}
          {route === 'characters' && <Characters />}
          {route === 'lorebooks' && <Lorebooks />}
          {route === 'plots' && <Plots />}
          {route === 'settings' && <Settings />}
        </div>
      </main>
      {route === 'home' ? <BigFooter /> : <SmallFooter wide={wide} />}
      <Toasts />
    </div>
  );
}

function Header({ route, wide }: { route: Route; wide: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const conn = useStore((s) => s.conn);
  const ready = isConfigured(conn);
  const nav: [Route, string][] = [
    ['home', t.c.navHome],
    ['presets', t.c.navPresets],
    ['characters', t.c.navChars],
    ['lorebooks', t.c.navLore],
    ['plots', t.c.navPlots],
  ];
  return (
    <header className={wide ? 'wrap wide hdr' : 'wrap hdr'}>
      <a href={href('home')} className="logo">
        <Logo />
        <span className="serif">{t.c.brand}</span>
      </a>
      <nav aria-label={t.c.navLabel} className="nav">
        {nav.map(([r, label]) => (
          <a key={r} className={route === r ? 'navlink on' : 'navlink'} href={href(r)} aria-current={route === r ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div className="hdr-tools">
        <a href={href('settings')} className={ready ? 'apibadge on' : 'apibadge off'} aria-current={route === 'settings' ? 'page' : undefined} title={t.c.apiTitle}>
          <span className="dot" />
          {ready ? (
            <span className="mono">{conn.provider === 'st' ? stLabel(conn) : conn.model}</span>
          ) : (
            <>
              <span className="lbl">{t.c.apiOff}</span>
              <span className="lbl-short" aria-hidden="true">
                API
              </span>
            </>
          )}
        </a>
        <div role="group" aria-label={t.c.langLabel} className="segs">
          {(['ru', 'en'] as const).map((l) => (
            <button key={l} type="button" className={lang === l ? 'seg on' : 'seg'} aria-pressed={lang === l} onClick={() => setState((s) => ({ lang: l, outLang: s.outLang === s.lang ? l : s.outLang }))}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {inST() && (
          <button type="button" className="iconbtn lg closest" onClick={closeST} aria-label={t.st.close} title={t.st.close}>
            <X size={20} />
          </button>
        )}
      </div>
    </header>
  );
}

function SmallFooter({ wide }: { wide: boolean }) {
  const t = useT();
  const socials = activeSocials();
  return (
    <footer className="foot">
      <div className={wide ? 'wrap wide foot-line' : 'wrap foot-line'}>
        <span className="serif">{t.c.brand}</span>
        {socials.length > 0 && (
          <nav aria-label={t.c.socialTitle} className="flinks">
            {socials.map((s) => (
              <a key={s.name} className="flink" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
            ))}
          </nav>
        )}
      </div>
      <div className="lace flip" />
    </footer>
  );
}

function BigFooter() {
  const t = useT();
  const socials = activeSocials();
  return (
    <footer className="bigfoot">
      <div className="paper">
        <div className="wrap inner">
          <div className="about">
            <span className="serif">{t.c.brand}</span>
            <p>{t.c.footerAbout}</p>
            <p>{t.c.disclaimer}</p>
          </div>
          <div className="soc">
            {socials.length > 0 && (
              <>
                <span>{t.c.findMe}</span>
                <div className="row">
                  {socials.map((s) => (
                    <a key={s.name} className="social" href={s.url} target="_blank" rel="noopener noreferrer">
                      <SocialIcon name={s.icon} />
                      {s.name}
                    </a>
                  ))}
                </div>
              </>
            )}
            <span style={{ fontSize: 13, color: '#5c5350', textTransform: 'none', letterSpacing: 0 }}>{fmt(t.c.madeBy, { name: AUTHOR, year: new Date().getFullYear() })}</span>
          </div>
        </div>
      </div>
      <div className="lace flip" />
    </footer>
  );
}
