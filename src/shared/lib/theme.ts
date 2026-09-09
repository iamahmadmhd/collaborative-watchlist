import { useSyncExternalStore } from 'react';

// FR-THEME-1..6. This is a localStorage-backed external store, not a new global
// store in the CLAUDE.md sense (Redux/Zustand/etc) — it holds exactly one string
// preference, mirrors the browser's own persistence primitive, and is read via
// React's built-in useSyncExternalStore rather than a context provider. It has to
// live in shared/lib (not app/providers, despite styles.css's own note pointing
// there) so every layer can reach it: pages/settings and shared/ui/theme-toggle
// both need it, and eslint-plugin-boundaries forbids anything below `app` from
// importing it (CLAUDE.md's layer rules are enforced, not advisory).
//
// index.html carries a parallel, deliberately duplicated copy of resolveTheme's
// logic in a pre-paint inline script (FR-THEME-5) — that script runs before any
// bundle loads, so it can't import this module. Change the resolution rule in one
// place, change it in both.
export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function getDarkMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia('(prefers-color-scheme: dark)');
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
    if (preference === 'system') {
        return getDarkMediaQuery()?.matches ? 'dark' : 'light';
    }
    return preference;
}

function readStoredPreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
        return 'system';
    }
}

function applyResolvedTheme(resolved: ResolvedTheme) {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
}

let currentPreference: ThemePreference = readStoredPreference();
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((listener) => listener());
}

// FR-THEME-4: while set to 'system', track OS changes live, no reload required.
// Attached lazily on first subscription rather than at module load — this file
// gets pulled in by plain unit tests (any test that renders a component using
// shared/ui/theme-toggle) via jsdom, which doesn't implement matchMedia unless a
// test explicitly polyfills it; getDarkMediaQuery()'s feature-detection keeps that
// a silent no-op there instead of a hard failure at import time.
let mediaListenerAttached = false;
function ensureMediaListener() {
    if (mediaListenerAttached) return;
    const media = getDarkMediaQuery();
    if (!media) return;
    mediaListenerAttached = true;
    media.addEventListener('change', () => {
        if (currentPreference === 'system') {
            applyResolvedTheme(resolveTheme('system'));
            notify();
        }
    });
}

export function getThemePreference(): ThemePreference {
    return currentPreference;
}

export function setThemePreference(preference: ThemePreference) {
    currentPreference = preference;
    try {
        localStorage.setItem(STORAGE_KEY, preference);
    } catch {
        // Storage can throw (private browsing, quota) — the theme still applies for
        // this load, it just won't persist across sessions/devices (FR-THEME-3's
        // guarantee is best-effort against that, not absolute).
    }
    applyResolvedTheme(resolveTheme(preference));
    notify();
}

function subscribeToTheme(listener: () => void): () => void {
    ensureMediaListener();
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// FR-THEME-1/2/3/4. Three states, system by default, persisted, live-tracked.
// FR-THEME-5 (no flash) is handled outside React entirely, by index.html's inline
// script — this hook only needs to reflect whatever that script already applied.
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
    const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, getThemePreference);
    return [preference, setThemePreference];
}
