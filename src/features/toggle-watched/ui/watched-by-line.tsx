// Every member's mark on this film, not just the reader's own.
//
// An id with no current member behind it is expected rather than a data fault: a mark
// outlives its member's place on the list. See System Design §4.2.
export function WatchedByLine({
    watchedBy,
    memberLabels,
    currentUserId,
    className,
}: {
    watchedBy: readonly string[];
    memberLabels: Map<string, string>;
    currentUserId: string | undefined;
    className?: string | undefined;
}) {
    if (watchedBy.length === 0) {
        return <span className={`text-muted text-xs ${className ?? ''}`}>Not watched by anyone</span>;
    }

    // Sorts the reader's own entry to the front, and names it "You".
    const labels = [...watchedBy]
        .sort((a, b) => Number(b === currentUserId) - Number(a === currentUserId))
        .map((id) => (id === currentUserId ? 'You' : (memberLabels.get(id) ?? 'A former member')));

    return (
        <span className={`text-muted text-xs ${className ?? ''}`}>
            Watched by {new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)}
        </span>
    );
}
