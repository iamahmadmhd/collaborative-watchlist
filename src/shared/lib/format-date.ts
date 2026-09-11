// Formats an ISO date string, guarding both a missing value and an Invalid Date that
// Intl.DateTimeFormat would otherwise render as the literal "Invalid Date".
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
