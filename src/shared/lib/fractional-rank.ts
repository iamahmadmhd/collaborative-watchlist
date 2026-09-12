// Fractional string ranks, so moving or inserting an item writes one rank rather than N
// — see System Design §5.3. Ranks are base-36 strings that sort correctly under plain
// string comparison: DIGITS is in ascending lexicographic order, so string and numeric
// digit comparison agree.
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digitAt(value: string, index: number): number {
    return index < value.length ? DIGITS.indexOf(value.charAt(index)) : 0;
}

// Returns a rank sorting strictly between `lo` and `hi`; a null bound means insert at
// the very start or very end. Only the latter is exercised today, via rankAfter —
// general betweenness is here for drag-reordering.
//
// Once a digit position is found where `lo` sorts strictly below `hi`, anything appended
// after it is already < hi regardless of value, so `hi` stops constraining subsequent
// positions (hiIsOpen) rather than being re-read at every depth.
export function rankBetween(lo: string | null, hi: string | null): string {
    if (lo !== null && hi !== null && lo >= hi) {
        throw new Error('rankBetween: lo must sort strictly before hi');
    }

    let result = '';
    let hiIsOpen = hi === null;
    for (let i = 0; ; i++) {
        const loDigit = lo ? digitAt(lo, i) : 0;
        const hiDigit = hiIsOpen ? BASE : digitAt(hi as string, i);
        const gap = hiDigit - loDigit;
        if (gap >= 2) {
            result += DIGITS[loDigit + Math.floor(gap / 2)];
            return result;
        }
        result += DIGITS[loDigit];
        if (gap === 1) {
            hiIsOpen = true;
        }
    }
}

// A newly added item goes at the end. `lastRank` is the current final item's position,
// or null for an empty list.
export function rankAfter(lastRank: string | null): string {
    return rankBetween(lastRank, null);
}
