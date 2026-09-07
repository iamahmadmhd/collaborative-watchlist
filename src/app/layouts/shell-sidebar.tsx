import { Link } from '@tanstack/react-router';
import { useCurrentUser } from '../../entities/member/api/use-current-user';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { memberColor, memberInitial } from '../../entities/member/model/member-color';

export type ShellSection = 'Discover' | 'Saved' | 'Watchlists';

// docs/design/Shell Sidebar.dc.html, desktop nav rail (System Design nav:
// "left sidebar rail with the list of watchlists always visible"). Saved and
// Watchlists are rendered as non-interactive rows, not `<Link>`s, until those
// pages exist (build order steps 4/5) — a typed route to a page that isn't
// built yet either fails to compile or 404s at runtime; neither is better than
// an inert row for now. Their counts follow the same rule: Saved's is real
// (features/save-movie already exists), Watchlists' is omitted rather than
// showing the board's hardcoded "4" with nothing behind it.
//
// "YOUR LISTS" (docs/design) is left out entirely rather than than rendered
// with invented empty-state copy — there is no watchlist entity yet to be
// honest about. Reinstate it when watchlists land (build order step 5).

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
                <NavRow label='Saved' count={savedSet?.size} active={active === 'Saved'} />
                <NavRow label='Watchlists' active={active === 'Watchlists'} />
            </nav>
            <div className='border-border mt-auto flex items-center gap-2.5 border-t px-5 pt-3.5'>
                <div
                    className='text-raised flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full text-xs font-bold'
                    style={{ background: user ? memberColor(user.id) : undefined }}
                >
                    {user ? memberInitial(user.displayName ?? user.username ?? '?') : ''}
                </div>
                <div className='flex min-w-0 flex-col leading-tight'>
                    <span className='text-text truncate text-[13px] font-semibold'>
                        {user?.displayName ?? user?.username ?? '…'}
                    </span>
                    {user?.username && <span className='text-muted font-mono text-[10px]'>@{user.username}</span>}
                </div>
            </div>
        </aside>
    );
}
