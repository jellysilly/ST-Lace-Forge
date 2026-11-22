/**
 * Bridge to SillyTavern. The extension opens this app in a same-origin iframe over the ST page,
 * so the parent window's `SillyTavern.getContext()` is reachable. Outside ST (vite dev, a plain
 * browser tab) every helper here reports "not in ST" and the app works on its own.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type STContext = any;

interface Host {
  close?: () => void;
  version?: string;
}

function parentWin(): (Window & { SillyTavern?: { getContext?: () => STContext }; laceForge?: Host }) | null {
  try {
    if (typeof window === 'undefined' || window.parent === window) return null;
    // Touching a property throws on a cross-origin parent.
    void window.parent.location.href;
    return window.parent as never;
  } catch {
    return null;
  }
}

/** Live SillyTavern context, or null when the app runs on its own. */
export function stCtx(): STContext | null {
  try {
    const st = parentWin()?.SillyTavern;
    return typeof st?.getContext === 'function' ? st.getContext() : null;
  } catch {
    return null;
  }
}

let cached: boolean | null = null;
/** True when running inside SillyTavern. */
export function inST(): boolean {
  if (cached === null) cached = !!stCtx();
  return cached;
}

/** Hides the extension overlay. */
export function closeST() {
  parentWin()?.laceForge?.close?.();
}

/** SillyTavern UI language, for the first-run default. */
export function stLang(): string {
  try {
    const ctx = stCtx();
    const loc = ctx?.getCurrentLocale?.() ?? parentWin()?.localStorage.getItem('language') ?? '';
    return String(loc || '');
  } catch {
    return '';
  }
}

/** Request headers with ST's CSRF token. `json: false` leaves Content-Type to the browser (FormData). */
export function stHeaders(json = true): Record<string, string> {
  const ctx = stCtx();
  const h: Record<string, string> = { ...(ctx?.getRequestHeaders?.() ?? {}) };
  if (!json) {
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-type') delete h[k];
  } else if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
  return h;
}

export async function stFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...stHeaders(!(init.body instanceof FormData)), ...((init.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text || res.statusText}`.trim());
  }
  return res;
}
