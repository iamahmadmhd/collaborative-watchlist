import { Link } from '@tanstack/react-router';
import { useCurrentUser } from '../../entities/member/api/use-current-user';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { useWatchlists } from '../../entities/watchlist/api/use-watchlists';
import { memberColor, memberInitial } from '../../entities/member/model/member-color';

export type ShellSection = 'Discover' | 'Saved' | 'Watchlists' | 'Settings';

// Desktop nav rail.

function NavRow({
    label,
    count,
    active,
    to,
}: {
    label: string;
    count?: number | undefined;
    active: boolean;
    to?: string;
}) {
    const className = active
        ? 'bg-accent/12 text-accent flex items-center justify-between rounded-[3px] px-2.5 py-2 text-sm font-semibold'
        : 'text-text flex items-center justify-between rounded-[3px] px-2.5 py-2 text-sm';
    const content = (
        <>
            <span>{label}</span>
            {count !== undefined && <span className='text-muted font-mono text-[11px]'>{count}</span>}
        </>
    );
    if (to) {
        return (
            <Link to={to} className={className}>
                {content}
            </Link>
        );
    }
    return <div className={className}>{content}</div>;
}

export function ShellSidebar({ active, className }: { active: ShellSection; className?: string }) {
    const { data: user } = useCurrentUser();
    const { data: savedSet } = useSavedSet();
    const { data: watchlists } = useWatchlists();

    return (
        <aside
            className={`border-border bg-raised w-60 flex-none flex-col gap-6 overflow-y-auto border-r py-5.5 ${className ?? ''}`}
        >
            <div className='flex items-baseline gap-2 px-5'>
                <span className='font-display text-text text-lg font-bold tracking-[-0.02em]'>Repertory</span>
                <span className='text-muted font-mono text-[10px]'>v1.0</span>
            </div>
            <nav className='flex flex-col gap-0.5 px-3'>
                <NavRow label='Discover' active={active === 'Discover'} to='/discover' />
                <NavRow label='Saved' count={savedSet?.size} active={active === 'Saved'} to='/saved' />
                <NavRow label='Watchlists' count={watchlists?.length} active={active === 'Watchlists'} to='/lists' />
            </nav>
            {/* The identity block doubles as the desktop entry point to /settings —
                there is no separate nav row for it. */}
            <Link
                to='/settings'
                className={`border-border mt-auto flex items-center gap-2.5 border-t px-5 pt-3.5 ${active === 'Settings' ? 'text-accent' : ''}`}
            >
                <div
                    className='text-raised flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full text-xs font-bold'
                    style={{ background: user ? memberColor(user.id) : undefined }}
                >
                    {user ? memberInitial(user.displayName ?? user.username ?? '?') : ''}
                </div>
                <div className='flex min-w-0 flex-col leading-tight'>
                    <span className={`truncate text-[13px] font-semibold ${active === 'Settings' ? '' : 'text-text'}`}>
                        {user?.displayName ?? user?.username ?? '…'}
                    </span>
                    {user?.username && <span className='text-muted font-mono text-[10px]'>@{user.username}</span>}
                </div>
            </Link>
        </aside>
    );
}
