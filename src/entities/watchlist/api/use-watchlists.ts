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

// One query against the WatchlistMember byUser index: that table carries an OWNER row
// too, so it surfaces every list a member has any relationship to. It holds no display
// fields, so each membership needs its own Watchlist.get(), run in parallel and bounded
// by how many lists one member belongs to.
export function useWatchlists() {
    return useQuery({
        queryKey: WATCHLISTS_QUERY_KEY,
        queryFn: async (): Promise<MyWatchlist[]> => {
            const { userId } = await getCurrentUser();
            const { data: memberships } = await client.models.WatchlistMember.listWatchlistMemberByUserId({ userId });

            const watchlists = await Promise.all(
                // A membership entry can be null: GraphQL null-propagation nulls a list
                // item whose non-null field fails to resolve. Skipping it is a backstop,
                // not a repair — a missing membership is still a data-integrity bug.
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

// Exported for features/create-watchlist, which seeds this cache directly.
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
