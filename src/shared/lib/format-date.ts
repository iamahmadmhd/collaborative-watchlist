// Parses an ISO date string and formats it with `Intl.DateTimeFormat`, guarding
// the two ways this can go wrong: a missing value, and `new Date(iso)` producing
// an Invalid Date (`getTime()` is NaN) that `Intl.DateTimeFormat` would otherwise
// happily render as "Invalid Date". Centralised so callers only supply the
// `Intl.DateTimeFormatOptions` they need instead of re-deriving this guard.
export function formatIsoDate(iso: string | null | undefined, options: Intl.DateTimeFormatOptions): string | null {
    if (!iso) {
        return null;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return new Intl.DateTimeFormat('en-US', options).format(date);
}
