import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
    it('passes a same-origin absolute path through', () => {
        expect(safeRedirect('/lists/abc')).toBe('/lists/abc');
        expect(safeRedirect('/discover?page=2')).toBe('/discover?page=2');
    });

    it('falls back to / for a missing value', () => {
        expect(safeRedirect(undefined)).toBe('/');
        expect(safeRedirect(null)).toBe('/');
        expect(safeRedirect('')).toBe('/');
    });

    it('rejects protocol-relative and absolute URLs', () => {
        expect(safeRedirect('//evil.example')).toBe('/');
        expect(safeRedirect('/\\evil.example')).toBe('/');
        expect(safeRedirect('https://evil.example')).toBe('/');
        expect(safeRedirect('javascript:alert(1)')).toBe('/');
    });

    it('rejects a relative path, which would resolve against the current route', () => {
        expect(safeRedirect('lists/abc')).toBe('/');
    });
});
