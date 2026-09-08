import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';

// FR-WATCH-1..4, System Design §5.2 access pattern 5 / §5.1's WatchStatus row
// ((userId, itemId) primary key, watchlistId + watchedAt as plain attributes).
// The identifier is NOT (userId, watchlistId, tmdbId) — just (userId, itemId) —
// so a bare tmdbId can't be the itemId value: the same film in two different
// watchlists would collide on one WatchStatus row and "watched in list A" would
// leak into list B. `watchedItemId` composes watchlistId into the key so watched
// state stays scoped to one watchlist's entry, matching FR-WATCH-1's "item on a
// watchlist" framing (not "a film" globally). watchlistId is stored again as a
// plain attribute solely so the byUserAndList GSI can filter to one list.
function watchedItemId(watchlistId: string, tmdbId: string): string {
    return `${watchlistId}#${tmdbId}`;
}

function watchStatusQueryKey(watchlistId: string) {
    return ['watch-status', watchlistId];
}

// FR-WATCH-3: allow.owner() on WatchStatus (amplify/data/resource.ts) already
// scopes every read to the caller's own rows server-side — no explicit userId
// filter needed for authorization, only to satisfy the GSI's partition key.
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

// FR-WATCH-1/2. Optimistic onMutate/onError/onSettled with rollback (System
// Design §7.2), mirrored from features/save-movie's useToggleSave — this is a
// private per-member toggle with no subscription counterpart (WatchStatus
// carries no editors/viewers array to authorize one), so the query cache here
// is the only place this state lives client-side.
export function useToggleWatched(watchlistId: string) {
    const queryClient = useQueryClient();
    const queryKey = watchStatusQueryKey(watchlistId);

    return useMutation({
        mutationFn: async ({ tmdbId, isWatched }: { tmdbId: string; isWatched: boolean }) => {
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
        onMutate: async ({ tmdbId, isWatched }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<Set<string>>(queryKey);
            queryClient.setQueryData<Set<string>>(queryKey, (old) => {
                const next = new Set(old);
                if (isWatched) {
                    next.delete(tmdbId);
                } else {
                    next.add(tmdbId);
                }
                return next;
            });
            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKey, context.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });
}
