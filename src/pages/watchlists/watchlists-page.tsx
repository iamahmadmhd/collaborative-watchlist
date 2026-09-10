import { Link } from '@tanstack/react-router';
import { useWatchlists, type MyWatchlist } from '../../entities/watchlist/api/use-watchlists';
import { RoleBadge } from '../../entities/watchlist/ui/role-badge';
import { CreateWatchlistDialog } from '../../features/create-watchlist/ui/create-watchlist-dialog';
import { formatRelativeTime } from '../../shared/lib/format-relative-time';
import { QueryState } from '../../shared/ui/query-state';

// docs/design/Watchlists.dc.html. Member avatars/count per row are dropped — see
// entities/watchlist/api/use-watchlists.ts's own comment on why that data isn't
// cheaply available on this screen. The dashed "start a list" tip is the empty
// state rather than a permanent footer under the row list (the board renders it
// unconditionally, outside its sc-for loop, but that board only ever shows four
// hardcoded sample rows — it never has an empty state to distinguish from).
export function WatchlistsPage() {
    const watchlistsQuery = useWatchlists();
    const count = watchlistsQuery.data?.length;
    const breakdown = watchlistsQuery.data && summarizeRoles(watchlistsQuery.data);

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <header className='border-border bg-raised flex flex-none items-end justify-between border-b px-7 py-5.5'>
                    <div className='flex flex-col gap-1.5'>
                        <h1 className='font-display text-text m-0 text-[30px] font-bold tracking-tight'>Watchlists</h1>
                        <span className='text-muted font-mono text-[11px]'>
                            {count === undefined
                                ? '…'
                                : `${count} list${count === 1 ? '' : 's'}${breakdown ? ` · ${breakdown}` : ''}`}
                        </span>
                    </div>
                    <CreateWatchlistDialog />
                </header>
                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-5.5'>
                    <WatchlistsList watchlistsQuery={watchlistsQuery} />
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <div className='border-border bg-raised flex flex-none items-end justify-between border-b px-4 pt-11 pb-3'>
                    <h1 className='font-display text-text m-0 text-[24px] font-bold tracking-[-0.02em]'>Watchlists</h1>
                    <CreateWatchlistDialog />
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <WatchlistsList watchlistsQuery={watchlistsQuery} />
                </div>
            </div>
        </>
    );
}

function summarizeRoles(watchlists: MyWatchlist[]): string {
    const owned = watchlists.filter((w) => w.role === 'OWNER').length;
    const editing = watchlists.filter((w) => w.role === 'EDITOR').length;
    const viewing = watchlists.filter((w) => w.role === 'VIEWER').length;
    return [owned > 0 && `${owned} owned`, editing > 0 && `${editing} editing`, viewing > 0 && `${viewing} viewing`]
        .filter(Boolean)
        .join(', ');
}

function WatchlistsList({ watchlistsQuery }: { watchlistsQuery: ReturnType<typeof useWatchlists> }) {
    return (
        <QueryState
            query={watchlistsQuery}
            pending={
                <div className='flex flex-col gap-3.5'>
                    {Array.from({ length: 4 }, (_, i) => (
                        <div key={i} className='border-border bg-raised h-24 animate-pulse rounded-sm border' />
                    ))}
                </div>
            }
            errorPrefix='Could not load watchlists.'
            isEmpty={(data) => data.length === 0}
            empty={
                <div className='border-border flex flex-col items-center gap-1.5 rounded-sm border border-dashed p-5.5'>
                    <span className='text-text font-body text-sm font-semibold'>
                        Start a list, then add friends by @username
                    </span>
                    <span className='text-muted font-mono text-[11px]'>UP TO 20 MEMBERS PER LIST</span>
                </div>
            }
        >
            {(data) => (
                <div className='flex flex-col gap-3.5'>
                    {data.map((watchlist) => (
                        <WatchlistRow key={watchlist.id} watchlist={watchlist} />
                    ))}
                </div>
            )}
        </QueryState>
    );
}

// FR-LIST-5's row is now the entry point into /lists/:id (watchlist-detail-page.tsx)
// — the only reachable path there besides typing the URL directly.
function WatchlistRow({ watchlist }: { watchlist: MyWatchlist }) {
    return (
        <Link
            to='/lists/$watchlistId'
            params={{ watchlistId: watchlist.id }}
            className='border-border bg-raised hover:border-accent flex flex-col gap-3 rounded-sm border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4.5'
        >
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                <div className='flex items-center gap-2.5'>
                    <span className='font-display text-text truncate text-[17px] font-semibold tracking-[-0.015em] lg:text-[19px]'>
                        {watchlist.name}
                    </span>
                    <RoleBadge role={watchlist.role} />
                </div>
                {watchlist.description && (
                    <span className='text-muted font-body truncate text-[13px]'>{watchlist.description}</span>
                )}
            </div>
            <div className='text-muted flex flex-none items-center gap-3.5 font-mono text-[11px]'>
                <span className='text-text'>
                    {watchlist.itemCount} item{watchlist.itemCount === 1 ? '' : 's'}
                </span>
                {watchlist.updatedAt && <span>{formatRelativeTime(watchlist.updatedAt)}</span>}
            </div>
        </Link>
    );
}
