const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
    { amount: 60, unit: 'seconds' },
    { amount: 60, unit: 'minutes' },
    { amount: 24, unit: 'hours' },
    { amount: 7, unit: 'days' },
    { amount: 4.348, unit: 'weeks' },
    { amount: 12, unit: 'months' },
    { amount: Number.POSITIVE_INFINITY, unit: 'years' },
];

// narrow + numeric:'always' is the one Intl.RelativeTimeFormat configuration
// that reproduces docs/design/Saved.dc.html's "2d ago" / "1w ago" / "1mo ago"
// style exactly — numeric:'auto' substitutes "yesterday"/"last wk." for the
// 1-unit case, which the mock never shows.
const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' });

export function formatRelativeTime(iso: string, now = Date.now()): string {
    let duration = (new Date(iso).getTime() - now) / 1000;
    for (const division of DIVISIONS) {
        if (Math.abs(duration) < division.amount) {
            return formatter.format(Math.round(duration), division.unit);
        }
        duration /= division.amount;
    }
    return formatter.format(Math.round(duration), 'years');
}
