import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/24/solid';
import { useWatchlist } from '../../entities/watchlist/api/use-watchlist';
import { useWatchlistRole } from '../../entities/watchlist/api/use-watchlist-role';
import {
    useWatchlistMembers,
    type WatchlistMemberWithProfile,
} from '../../entities/watchlist/api/use-watchlist-members';
import { useWatchlistItems } from '../../entities/watchlist/api/watchlist-items';
import { canEditWatchlist } from '../../entities/watchlist/model/watchlist';
import type { WatchlistItemRecord, WatchlistRecord } from '../../entities/watchlist/model/watchlist';
import { RoleBadge } from '../../entities/watchlist/ui/role-badge';
import { memberColor, memberInitial } from '../../entities/member/model/member-color';
import { posterUrl } from '../../entities/movie/model/movie';
import { HATCH_STYLE } from '../../entities/movie/ui/movie-card';
import { formatRelativeTime } from '../../shared/lib/format-relative-time';
import { useRemoveListItem } from '../../features/manage-list-items/api/manage-list-items';

// docs/design has no Watchlist Detail mock (only README.md — see docs/design/
// and CLAUDE.md's design-reference note); this follows the same fallback
// create-watchlist-dialog.tsx already established for a screen with no board
// to transcribe: token system + the layout conventions the other screens in
// this codebase already settled on (desktop/mobile split, skeleton/empty/error
// states), rather than inventing screen composition from nothing.
//
// FR-LIST-2/3 (rename/re-describe) and the manage-members feature (add/remove
// a collaborator by @username) are deliberately not built here — both are
// separate FSD feature slices from manage-list-items (System Design §2.2's
// module structure lists them apart), out of scope for "list detail and add
// to list". Members render read-only. FR-ITEM-5 (drag reorder, dnd-kit,
// "Should") is likewise deferred — this only appends (ADR-006's rankAfter),
// it never reorders.
export function WatchlistDetailPage({ watchlistId }: { watchlistId: string }) {
    const watchlistQuery = useWatchlist(watchlistId);
    const roleQuery = useWatchlistRole(watchlistId);
    const membersQuery = useWatchlistMembers(watchlistId);
    const itemsQuery = useWatchlistItems(watchlistId);

    function handleBack() {
        window.history.back();
    }

    if (watchlistQuery.isPending) {
        return <PageSkeleton onBack={handleBack} />;
    }

    if (watchlistQuery.isError || watchlistQuery.data === null) {
        return (
            <div className='flex min-h-0 flex-1 flex-col'>
                <DetailHeader onBack={handleBack} />
                <p className='text-danger font-body p-7 text-sm' role='alert'>
                    This watchlist doesn&apos;t exist, or you don&apos;t have access to it.
                </p>
            </div>
        );
    }

    const watchlist = watchlistQuery.data;
    const canEdit = canEditWatchlist(roleQuery.data);
    const memberLabels = new Map((membersQuery.data ?? []).map((m) => [m.userId, m.displayName ?? m.username ?? '?']));

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <DetailHeader onBack={handleBack} />
                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-5.5'>
                    <ListHeading watchlist={watchlist} role={roleQuery.data} itemCount={itemsQuery.data?.length} />
                    <MembersRow membersQuery={membersQuery} className='mt-4' />
                    <ItemsSection
                        itemsQuery={itemsQuery}
                        canEdit={canEdit}
                        memberLabels={memberLabels}
                        watchlistId={watchlistId}
                        className='mt-6'
                    />
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <MobileHeader onBack={handleBack} />
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <ListHeading watchlist={watchlist} role={roleQuery.data} itemCount={itemsQuery.data?.length} />
                    <MembersRow membersQuery={membersQuery} className='mt-3' />
                    <ItemsSection
                        itemsQuery={itemsQuery}
                        canEdit={canEdit}
                        memberLabels={memberLabels}
                        watchlistId={watchlistId}
                        className='mt-4'
                    />
                </div>
            </div>
        </>
    );
}

function DetailHeader({ onBack }: { onBack: () => void }) {
    return (
        <header className='border-border bg-raised flex flex-none items-center gap-3.5 border-b px-7 py-3.5'>
            <button
                type='button'
                onClick={onBack}
                className='text-muted hover:text-text flex items-center gap-2 font-mono text-[11px] tracking-[0.02em]'
            >
                <ArrowLeftIcon className='size-4' /> BACK TO WATCHLISTS
            </button>
        </header>
    );
}

function MobileHeader({ onBack }: { onBack: () => void }) {
    return (
        <div className='border-border bg-raised flex flex-none items-center justify-between px-4 pt-11 pb-2.5'>
            <button type='button' onClick={onBack} className='text-muted flex items-center gap-2 font-mono text-[11px]'>
                <ArrowLeftIcon className='size-4' /> BACK
            </button>
        </div>
    );
}

function ListHeading({
    watchlist,
    role,
    itemCount,
}: {
    watchlist: Pick<WatchlistRecord, 'name' | 'description' | 'itemCount'>;
    role: string | null | undefined;
    itemCount: number | undefined;
}) {
    // itemCount comes from the FR-LIST-6 stream-maintained counter (Watchlist.itemCount)
    // until the real-time item list resolves, then switches to the actual length — the
    // former can be briefly stale after a rapid add/remove (§5.4, Known Limitation #2).
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
            </span>
        </div>
    );
}

function MembersRow({
    membersQuery,
    className,
}: {
    membersQuery: ReturnType<typeof useWatchlistMembers>;
    className?: string;
}) {
    if (membersQuery.isPending || membersQuery.isError || membersQuery.data.length === 0) {
        return null;
    }

    return (
        <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
            {membersQuery.data.map((member) => (
                <MemberBadge key={member.userId} member={member} />
            ))}
        </div>
    );
}

function MemberBadge({ member }: { member: WatchlistMemberWithProfile }) {
    const label = member.displayName ?? (member.username ? `@${member.username}` : 'Member');

    return (
        <div className='border-border bg-raised flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1'>
            <div
                className='text-raised flex size-5 flex-none items-center justify-center rounded-full text-[10px] font-bold'
                style={{ background: memberColor(member.userId) }}
            >
                {memberInitial(label)}
            </div>
            <span className='text-text text-xs font-medium'>{label}</span>
        </div>
    );
}

function ItemsSection({
    itemsQuery,
    canEdit,
    memberLabels,
    watchlistId,
    className,
}: {
    itemsQuery: ReturnType<typeof useWatchlistItems>;
    canEdit: boolean;
    memberLabels: Map<string, string>;
    watchlistId: string;
    className?: string;
}) {
    if (itemsQuery.isPending) {
        return (
            <div className={`flex flex-col gap-3 ${className ?? ''}`}>
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className='bg-raised h-20 animate-pulse rounded-sm' />
                ))}
            </div>
        );
    }

    if (itemsQuery.isError) {
        return (
            <p className={`text-danger font-body text-sm ${className ?? ''}`} role='alert'>
                Could not load this list&apos;s films.{' '}
                {itemsQuery.error instanceof Error ? itemsQuery.error.message : ''}
            </p>
        );
    }

    if (itemsQuery.data.length === 0) {
        return (
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
        );
    }

    return (
        <div className={`flex flex-col gap-2.5 ${className ?? ''}`}>
            {itemsQuery.data.map((item) => (
                <ItemRow
                    key={item.tmdbId}
                    item={item}
                    canEdit={canEdit}
                    addedByLabel={memberLabels.get(item.addedBy) ?? 'A member'}
                    watchlistId={watchlistId}
                />
            ))}
        </div>
    );
}

function ItemRow({
    item,
    canEdit,
    addedByLabel,
    watchlistId,
}: {
    item: WatchlistItemRecord;
    canEdit: boolean;
    addedByLabel: string;
    watchlistId: string;
}) {
    const removeItem = useRemoveListItem(watchlistId);
    const poster = posterUrl(item.posterPath, 'w185');

    return (
        <div className='border-border bg-raised flex items-center gap-3.5 overflow-hidden rounded-sm border'>
            {/* Design System §3.4, the Attribution Stripe: the signature element — a
                thin bar in the colour of whoever added this item, so a busy shared
                list reads as a scannable spectrum of contributors at a glance. */}
            <div className='h-16 w-1.5 flex-none self-stretch' style={{ background: memberColor(item.addedBy) }} />
            <div
                className='bg-surface aspect-2/3 h-16 flex-none overflow-hidden rounded-xs'
                style={poster ? undefined : HATCH_STYLE}
            >
                {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
            </div>
            <div className='flex min-w-0 flex-1 flex-col gap-0.5 py-2'>
                <span className='text-text truncate text-[14px] font-semibold'>{item.title}</span>
                <span className='text-muted font-mono text-[11px]'>{item.releaseYear ?? '—'}</span>
                <span className='text-muted text-xs'>
                    Added by {addedByLabel}
                    {item.addedAt && <> · {formatRelativeTime(item.addedAt)}</>}
                </span>
            </div>
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
            <DetailHeader onBack={onBack} />
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
