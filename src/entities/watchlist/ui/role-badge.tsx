import { tv } from 'tailwind-variants';
import type { WatchlistRole } from '../model/watchlist';

// The visible role marker, reused everywhere a WatchlistRole renders.
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
