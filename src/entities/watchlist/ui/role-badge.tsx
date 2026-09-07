import { tv } from 'tailwind-variants';
import type { WatchlistRole } from '../model/watchlist';

// docs/design Watchlists.dc.html / Watchlist Detail.dc.html's ROLE map, ported to
// this project's own token names (docs/design/README.md's "known conflicts" note
// — the underlying colour values match). NFR-USE-2: a member's role must be
// visible wherever it constrains what they can do; this is that visible marker,
// reused everywhere a WatchlistRole needs to render (the /lists row today,
// watchlist-detail and the member list later).
const roleBadge = tv({
    base: 'inline-flex items-center rounded-[2px] border px-1.5 py-0.75 font-mono text-[9px] tracking-[0.08em] uppercase',
    variants: {
        role: {
            OWNER: 'bg-accent text-accent-contrast border-accent',
            EDITOR: 'text-accent border-accent bg-transparent',
            VIEWER: 'text-muted border-border bg-transparent',
        } satisfies Record<WatchlistRole, string>,
    },
});

export function RoleBadge({ role, className }: { role: WatchlistRole; className?: string }) {
    return <span className={roleBadge({ role, className })}>{role}</span>;
}
