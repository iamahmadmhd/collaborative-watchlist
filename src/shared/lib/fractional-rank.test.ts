import { describe, expect, it } from 'vitest';
import { rankAfter, rankBetween } from './fractional-rank';

describe('rankBetween', () => {
    it('returns a midpoint rank for an empty list (no bounds)', () => {
        expect(rankBetween(null, null)).toBe('i');
    });

    it('sorts strictly between two adjacent ranks, growing the string when digits are adjacent', () => {
        const lo = 'a';
        const hi = 'b';
        const mid = rankBetween(lo, hi);
        expect(mid > lo).toBe(true);
        expect(mid < hi).toBe(true);
    });

    it('sorts strictly between two arbitrary ranks', () => {
        const lo = 'g';
        const hi = 'm';
        const mid = rankBetween(lo, hi);
        expect(mid > lo).toBe(true);
        expect(mid < hi).toBe(true);
    });

    it('handles an unbounded lower side (insert at the start)', () => {
        const hi = 'a';
        const rank = rankBetween(null, hi);
        expect(rank < hi).toBe(true);
    });

    it('handles an unbounded upper side (insert at the end)', () => {
        const lo = 'z';
        const rank = rankBetween(lo, null);
        expect(rank > lo).toBe(true);
    });

    it('throws when lo does not sort before hi', () => {
        expect(() => rankBetween('b', 'a')).toThrow();
        expect(() => rankBetween('a', 'a')).toThrow();
    });

    it('repeated appends stay strictly increasing', () => {
        let rank: string | null = null;
        const ranks: string[] = [];
        for (let i = 0; i < 20; i++) {
            rank = rankAfter(rank);
            ranks.push(rank);
        }
        const sorted = [...ranks].sort();
        expect(ranks).toEqual(sorted);
        expect(new Set(ranks).size).toBe(ranks.length);
    });

    it('repeated inserts into the same gap stay strictly ordered', () => {
        let lo = 'a';
        const hi = 'b';
        const ranks: string[] = [];
        for (let i = 0; i < 10; i++) {
            const mid = rankBetween(lo, hi);
            expect(mid > lo).toBe(true);
            expect(mid < hi).toBe(true);
            ranks.push(mid);
            lo = mid;
        }
        const sorted = [...ranks].sort();
        expect(ranks).toEqual(sorted);
    });
});

describe('rankAfter', () => {
    it('appends after the last rank', () => {
        const first = rankAfter(null);
        const second = rankAfter(first);
        expect(second > first).toBe(true);
    });
});
