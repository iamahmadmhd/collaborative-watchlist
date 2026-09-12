import { useSyncExternalStore } from 'react';

// A localStorage-backed external store holding one string preference, read via
// useSyncExternalStore rather than a context provider. It lives in shared/lib, not
// app/providers, because both pages/settings and shared/ui need it and nothing below
// `app` may import from it.
//
// index.html carries a deliberately duplicated copy of resolveTheme's logic in a
// pre-paint inline script, which runs before any bundle loads and so cannot import this
// module. Change the resolution rule in one place, change it in both.
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

// While set to 'system', OS changes are tracked live. Attached lazily on first
// subscription rather than at module load: jsdom does not implement matchMedia unless a
// test polyfills it, and the feature detection keeps that a no-op rather than a hard
// failure at import time.
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
        // Storage can throw in private browsing or on quota; the theme still applies
        // for this load, it just will not persist.
    }
    applyResolvedTheme(resolveTheme(preference));
    notify();
}

function subscribeToTheme(listener: () => void): () => void {
    ensureMediaListener();
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Three states, system by default, persisted and live-tracked. Avoiding the initial
// flash happens outside React, in index.html's inline script; this hook only reflects
// what that script already applied.
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
    const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, getThemePreference);
    return [preference, setThemePreference];
}
