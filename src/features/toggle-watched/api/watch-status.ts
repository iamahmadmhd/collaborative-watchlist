import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { useOptimisticMutation } from '../../../shared/lib/use-optimistic-mutation';

// WatchStatus is keyed (userId, itemId), so a bare tmdbId cannot be the itemId: the
// same film in two watchlists would collide on one row and "watched in list A" would
// leak into list B. `watchedItemId` composes watchlistId into the key instead.
// watchlistId is stored again as a plain attribute purely for the byUserAndList GSI.
function watchedItemId(watchlistId: string, tmdbId: string): string {
    return `${watchlistId}#${tmdbId}`;
}

function watchStatusQueryKey(watchlistId: string) {
    return ['watch-status', watchlistId];
}

// allow.owner() already scopes every read to the caller's own rows; the userId here
// satisfies the GSI's partition key, not authorization.
export function useWatchedSet(watchlistId: string) {
    return useQuery({
        queryKey: watchStatusQueryKey(watchlistId),
        queryFn: async (): Promise<Set<string>> => {
            const { userId } = await getCurrentUser();
            const { data } = await client.models.WatchStatus.listWatchStatusByUserIdAndWatchlistId({
                userId,
                watchlistId: { eq: watchlistId },
            });
            const prefix = `${watchlistId}#`;
            return new Set(data.map((status) => status.itemId.slice(prefix.length)));
        },
    });
}

// A private per-member toggle with no subscription counterpart — WatchStatus carries no
// permission arrays to authorize one — so this cache is the only place the state lives
// client-side.
export function useToggleWatched(watchlistId: string) {
    return useOptimisticMutation<{ tmdbId: string; isWatched: boolean }, Set<string>>({
        queryKey: () => watchStatusQueryKey(watchlistId),
        mutationFn: async ({ tmdbId, isWatched }) => {
            const { userId } = await getCurrentUser();
            const itemId = watchedItemId(watchlistId, tmdbId);
            if (isWatched) {
                await client.models.WatchStatus.delete({ userId, itemId });
            } else {
                await client.models.WatchStatus.create({
                    userId,
                    itemId,
                    watchlistId,
                    watchedAt: new Date().toISOString(),
                });
            }
        },
        optimisticUpdate: (previous, { tmdbId, isWatched }) => {
            const next = new Set(previous);
            if (isWatched) {
                next.delete(tmdbId);
            } else {
                next.add(tmdbId);
            }
            return next;
        },
    });
}
