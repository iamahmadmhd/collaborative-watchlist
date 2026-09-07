import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRecord, WatchlistRole } from '../model/watchlist';

export const WATCHLISTS_QUERY_KEY = ['watchlists'];

export interface MyWatchlist {
    id: string;
    name: string;
    description: string | null;
    itemCount: number;
    role: WatchlistRole;
    updatedAt: string | null;
}

// FR-LIST-5, System Design §5.2 access pattern 3 ("my lists with role" -> the
// WatchlistMember byUser index). §5.1 explains why this is one query rather than
// two merged client-side: WatchlistMember carries an OWNER row for the owner too,
// so byUser surfaces every list a member has any relationship to. It carries only
// watchlistId + role though, not the parent's display fields, so each membership
// still needs its own Watchlist.get() for name/description/itemCount — run in
// parallel, bounded by how many lists one member belongs to (a handful, not a
// pagination-worthy count).
//
// Member avatars/count per row (docs/design Watchlists.dc.html) are left out: §5.2
// has no access pattern for them on this screen (only pattern 6, "members and
// roles", scoped to /lists/:id) and Watchlist carries no memberCount the way it
// does itemCount (§5.4) — showing them here would mean an extra WatchlistMember
// query per list on every /lists load, which isn't a documented access pattern.
// Flagging rather than silently adding it (CLAUDE.md).
export function useWatchlists() {
    return useQuery({
        queryKey: WATCHLISTS_QUERY_KEY,
        queryFn: async (): Promise<MyWatchlist[]> => {
            const { userId } = await getCurrentUser();
            const { data: memberships } = await client.models.WatchlistMember.listWatchlistMemberByUserId({ userId });

            const watchlists = await Promise.all(
                // A membership entry can itself be null: GraphQL null-propagation nulls an
                // individual list item when one of its non-null fields fails to resolve
                // (e.g. a row missing createdAt/updatedAt — see permission-fanout/handler.ts
                // and membership/handler.ts's own comments on why that could happen for a
                // raw-SDK-written WatchlistMember row). Skipping it here is a defensive
                // backstop, not the fix for that; a membership silently missing from this
                // list is still a data-integrity bug worth surfacing separately, not one
                // this read path can repair.
                memberships.map(async (membership) => {
                    if (!membership || !membership.role) {
                        return null;
                    }
                    const { data: watchlist } = await client.models.Watchlist.get({ id: membership.watchlistId });
                    return watchlist ? toMyWatchlist(watchlist, membership.role) : null;
                }),
            );

            return watchlists.filter((watchlist): watchlist is MyWatchlist => watchlist !== null);
        },
    });
}

// Exported for features/create-watchlist: a freshly created Watchlist response
// already has everything this shape needs (see that hook's own comment on why
// it seeds the cache with this instead of invalidating).
export function toMyWatchlist(watchlist: WatchlistRecord, role: WatchlistRole): MyWatchlist {
    return {
        id: watchlist.id,
        name: watchlist.name,
        description: watchlist.description ?? null,
        itemCount: watchlist.itemCount ?? 0,
        role,
        updatedAt: watchlist.updatedAt ?? null,
    };
}
