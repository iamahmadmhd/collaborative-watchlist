import { Link, useNavigate } from '@tanstack/react-router';
import { TrashIcon } from '@heroicons/react/24/solid';
import { useWatchlist } from '../../entities/watchlist/api/use-watchlist';
import { useWatchlistRole } from '../../entities/watchlist/api/use-watchlist-role';
import { useWatchlistMembers } from '../../entities/watchlist/api/use-watchlist-members';
import { useWatchlistItems } from '../../entities/watchlist/api/watchlist-items';
import { canEditWatchlist, isWatchedBy, watchedByIds } from '../../entities/watchlist/model/watchlist';
import type { WatchlistItemRecord, WatchlistRecord } from '../../entities/watchlist/model/watchlist';
import { RoleBadge } from '../../entities/watchlist/ui/role-badge';
import { memberColor } from '../../entities/member/model/member-color';
import { useCurrentUser } from '../../entities/member/api/use-current-user';
import { posterUrl } from '../../entities/movie/model/movie';
import { HATCH_STYLE } from '../../entities/movie/ui/movie-card';
import { formatRelativeTime } from '../../shared/lib/format-relative-time';
import { useRemoveListItem } from '../../features/manage-list-items/api/manage-list-items';
import { ManageMembersSection } from '../../features/manage-members/ui/manage-members-section';
import { WatchedToggleButton } from '../../features/toggle-watched/ui/watched-toggle-button';
import { WatchedByLine } from '../../features/toggle-watched/ui/watched-by-line';
import { BackHeader, MobileBackHeader } from '../../shared/ui/back-header';
import { QueryState } from '../../shared/ui/query-state';

// Items are appended, never reordered — see System Design §11 for the deferred
// rename/re-describe and drag-reorder features.
export function WatchlistDetailPage({ watchlistId }: { watchlistId: string }) {
    const navigate = useNavigate();
    const watchlistQuery = useWatchlist(watchlistId);
    const roleQuery = useWatchlistRole(watchlistId);
    const membersQuery = useWatchlistMembers(watchlistId);
    const itemsQuery = useWatchlistItems(watchlistId);
    const currentUser = useCurrentUser();

    function handleBack() {
        window.history.back();
    }

    // Once a member leaves, this screen no longer resolves for them, so navigate away
    // rather than let the next refetch render the "doesn't exist" path.
    function handleLeft() {
        void navigate({ to: '/lists' });
    }

    if (watchlistQuery.isPending) {
        return <PageSkeleton onBack={handleBack} />;
    }

    if (watchlistQuery.isError || watchlistQuery.data === null) {
        return (
            <div className='flex min-h-0 flex-1 flex-col'>
                <BackHeader label='BACK TO WATCHLISTS' onBack={handleBack} />
                <p className='text-danger font-body p-7 text-sm' role='alert'>
                    This watchlist doesn&apos;t exist, or you don&apos;t have access to it.
                </p>
            </div>
        );
    }

    const watchlist = watchlistQuery.data;
    const canEdit = canEditWatchlist(roleQuery.data);
    const currentUserId = currentUser.data?.id;
    // Both counts come off the same array, so they cannot disagree.
    const items = itemsQuery.data;
    const watchedCount = items?.filter((item) => isWatchedBy(item, currentUserId)).length;
    const memberLabels = new Map((membersQuery.data ?? []).map((m) => [m.userId, m.displayName ?? m.username ?? '?']));

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <BackHeader label='BACK TO WATCHLISTS' onBack={handleBack} />
                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-5.5'>
                    <ListHeading
                        watchlist={watchlist}
                        role={roleQuery.data}
                        itemCount={items?.length}
                        watchedCount={watchedCount}
                    />
                    <ManageMembersSection
                        watchlistId={watchlistId}
                        role={roleQuery.data}
                        onLeft={handleLeft}
                        className='mt-4'
                    />
                    <ItemsSection
                        itemsQuery={itemsQuery}
                        canEdit={canEdit}
                        memberLabels={memberLabels}
                        currentUserId={currentUserId}
                        watchlistId={watchlistId}
                        className='mt-6'
                    />
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <MobileBackHeader label='BACK' onBack={handleBack} />
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <ListHeading
                        watchlist={watchlist}
                        role={roleQuery.data}
                        itemCount={items?.length}
                        watchedCount={watchedCount}
                    />
                    <ManageMembersSection
                        watchlistId={watchlistId}
                        role={roleQuery.data}
                        onLeft={handleLeft}
                        className='mt-3'
                    />
                    <ItemsSection
                        itemsQuery={itemsQuery}
                        canEdit={canEdit}
                        memberLabels={memberLabels}
                        currentUserId={currentUserId}
                        watchlistId={watchlistId}
                        className='mt-4'
                    />
                </div>
            </div>
        </>
    );
}

function ListHeading({
    watchlist,
    role,
    itemCount,
    watchedCount,
}: {
    watchlist: Pick<WatchlistRecord, 'name' | 'description' | 'itemCount'>;
    role: string | null | undefined;
    itemCount: number | undefined;
    watchedCount: number | undefined;
}) {
    // The stream-maintained counter until the item list resolves, then the actual
    // length — the former can be briefly stale after a rapid add or remove.
    const count = itemCount ?? watchlist.itemCount ?? 0;

    return (
        <div className='flex flex-col gap-1.5'>
            <div className='flex flex-wrap items-center gap-2.5'>
                <h1 className='font-display text-text m-0 text-[26px] font-bold tracking-tight lg:text-[30px]'>
                    {watchlist.name}
                </h1>
                {role && <RoleBadge role={role as 'OWNER' | 'EDITOR' | 'VIEWER'} />}
            </div>
            {watchlist.description && <p className='text-muted font-body max-w-160 text-sm'>{watchlist.description}</p>}
            <span className='text-muted font-mono text-[11px]'>
                {count} item{count === 1 ? '' : 's'}
                {/* undefined rather than 0 until the items resolve, so this does not
                    flash "0 watched" on every open. */}
                {watchedCount !== undefined && itemCount !== undefined && (
                    <>
                        {' '}
                        · {watchedCount} of {itemCount} watched
                    </>
                )}
            </span>
        </div>
    );
}

function ItemsSection({
    itemsQuery,
    canEdit,
    memberLabels,
    currentUserId,
    watchlistId,
    className,
}: {
    itemsQuery: ReturnType<typeof useWatchlistItems>;
    canEdit: boolean;
    memberLabels: Map<string, string>;
    currentUserId: string | undefined;
    watchlistId: string;
    className?: string;
}) {
    return (
        <QueryState
            query={itemsQuery}
            pending={
                <div className={`flex flex-col gap-3 ${className ?? ''}`}>
                    {Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className='bg-raised h-20 animate-pulse rounded-sm' />
                    ))}
                </div>
            }
            errorPrefix="Could not load this list's films."
            errorClassName={className}
            isEmpty={(data) => data.length === 0}
            empty={
                <div
                    className={`border-border flex flex-col items-center gap-1.5 rounded-sm border border-dashed p-5.5 ${className ?? ''}`}
                >
                    <span className='text-text font-body text-sm font-semibold'>No films yet</span>
                    <span className='text-muted font-mono text-[11px]'>
                        <Link to='/discover' search={{ page: 1 }} className='text-accent hover:underline'>
                            BROWSE
                        </Link>{' '}
                        OR{' '}
                        <Link to='/search' search={{ q: '', page: 1 }} className='text-accent hover:underline'>
                            SEARCH
                        </Link>{' '}
                        THEN ADD TO WATCHLIST
                    </span>
                </div>
            }
        >
            {(data) => (
                <div className={`flex flex-col gap-2.5 ${className ?? ''}`}>
                    {data.map((item) => (
                        <ItemRow
                            key={item.tmdbId}
                            item={item}
                            canEdit={canEdit}
                            addedByLabel={memberLabels.get(item.addedBy) ?? 'A member'}
                            memberLabels={memberLabels}
                            currentUserId={currentUserId}
                            watchlistId={watchlistId}
                        />
                    ))}
                </div>
            )}
        </QueryState>
    );
}

function ItemRow({
    item,
    canEdit,
    addedByLabel,
    memberLabels,
    currentUserId,
    watchlistId,
}: {
    item: WatchlistItemRecord;
    canEdit: boolean;
    addedByLabel: string;
    memberLabels: Map<string, string>;
    currentUserId: string | undefined;
    watchlistId: string;
}) {
    const removeItem = useRemoveListItem(watchlistId);
    const poster = posterUrl(item.posterPath, 'w185');
    const watchedBy = watchedByIds(item);
    const isWatched = isWatchedBy(item, currentUserId);

    return (
        <div className='border-border bg-raised flex items-center gap-3.5 overflow-hidden rounded-sm border'>
            {/* The attribution stripe: a thin bar in the colour of whoever added this
                item. See Design System §3.4. */}
            <div className='h-16 w-1.5 flex-none self-stretch' style={{ background: memberColor(item.addedBy) }} />
            <div
                className='bg-surface aspect-2/3 h-16 flex-none overflow-hidden rounded-xs'
                style={poster ? undefined : HATCH_STYLE}
            >
                {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
            </div>
            <div className='flex min-w-0 flex-1 flex-col gap-0.5 py-2'>
                <Link
                    to='/movie/$movieId'
                    params={{ movieId: item.tmdbId }}
                    className='text-text truncate text-[14px] font-semibold'
                >
                    {item.title}
                </Link>
                <span className='text-muted font-mono text-[11px]'>{item.releaseYear ?? '—'}</span>
                <span className='text-muted text-xs'>
                    Added by {addedByLabel}
                    {item.addedAt && <> · {formatRelativeTime(item.addedAt)}</>}
                </span>
                <WatchedByLine watchedBy={watchedBy} memberLabels={memberLabels} currentUserId={currentUserId} />
            </div>
            <WatchedToggleButton
                watchlistId={watchlistId}
                tmdbId={item.tmdbId}
                title={item.title}
                isWatched={isWatched}
                className={canEdit ? undefined : 'mr-3.5'}
            />
            {canEdit && (
                <button
                    type='button'
                    aria-label={`Remove ${item.title} from this watchlist`}
                    onClick={() => removeItem.mutate(item.tmdbId)}
                    disabled={removeItem.isPending}
                    className='text-muted hover:text-danger mr-3.5 flex-none disabled:cursor-not-allowed disabled:opacity-60'
                >
                    <TrashIcon className='size-4' />
                </button>
            )}
        </div>
    );
}

function PageSkeleton({ onBack }: { onBack: () => void }) {
    return (
        <div className='flex min-h-0 flex-1 flex-col'>
            <BackHeader label='BACK TO WATCHLISTS' onBack={onBack} />
            <div className='flex flex-col gap-3 p-7'>
                <div className='bg-raised h-8 w-1/3 animate-pulse rounded-sm' />
                <div className='bg-raised h-4 w-1/2 animate-pulse rounded-sm' />
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className='bg-raised mt-2 h-20 animate-pulse rounded-sm' />
                ))}
            </div>
        </div>
    );
}
