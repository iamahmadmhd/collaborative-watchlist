// ADR-006 / System Design §5.3: fractional string ranks for ordering, not
// sequential integers — moving or inserting one item writes one rank, not N
// (avoiding an N-item fan-out of subscription events for a single drag, V-9).
// Ranks are base-36 strings that sort correctly under plain JS string
// comparison; DIGITS is already in ascending lexicographic order, so string
// comparison and numeric digit comparison agree.
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digitAt(value: string, index: number): number {
    return index < value.length ? DIGITS.indexOf(value.charAt(index)) : 0;
}

// Returns a rank that sorts strictly between `lo` and `hi`. `lo === null`
// means "no lower bound" (insert at the very start); `hi === null` means "no
// upper bound" (insert at the very end — the only case this codebase
// currently exercises, via rankAfter; general betweenness is exposed for
// FR-ITEM-5's future drag-reorder feature, which needs to insert between two
// existing neighbours).
//
// Once a digit position is found where `lo` sorts strictly below `hi`,
// anything appended after that position is already guaranteed < hi
// regardless of its value — so `hi` stops constraining subsequent
// positions (hiIsOpen flips true) rather than being re-read at every depth.
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

// FR-ITEM-1: a newly added item goes at the end of the list. `lastRank` is
// the current final item's position, or null for an empty list.
export function rankAfter(lastRank: string | null): string {
    return rankBetween(lastRank, null);
}
