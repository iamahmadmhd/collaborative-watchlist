import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRole } from '../model/watchlist';

// The presentational-only permission hook: it decides which controls to render, never
// whether an operation is allowed — AppSync rejects the mutations regardless of what
// this returns. A point read, thanks to WatchlistMember's composite key. `null` covers
// both "not yet loaded" and "not a member"; callers needing to tell those apart read
// `.isPending` alongside it.
export function watchlistRoleQueryKey(watchlistId: string) {
    return ['watchlist-role', watchlistId];
}

export function useWatchlistRole(watchlistId: string) {
    return useQuery({
        queryKey: watchlistRoleQueryKey(watchlistId),
        queryFn: async (): Promise<WatchlistRole | null> => {
            const { userId } = await getCurrentUser();
            const { data } = await client.models.WatchlistMember.get({ watchlistId, userId });
            return data?.role ?? null;
        },
    });
}
