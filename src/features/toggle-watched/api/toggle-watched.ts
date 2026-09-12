import { client } from '../../../shared/lib/amplify-client';
import { watchlistItemsQueryKey } from '../../../entities/watchlist/api/watchlist-items';
import { useCurrentUser } from '../../../entities/member/api/use-current-user';
import { watchedByIds, type WatchlistItemRecord } from '../../../entities/watchlist/model/watchlist';
import { useOptimisticMutation } from '../../../shared/lib/use-optimistic-mutation';

// watchedBy rides the item rows, so this patches the items cache entry rather than one
// of its own, and there is no read hook here — the state arrives with the items query.

// toggleWatched returns a typed rejection rather than a GraphQL error string, so the
// client never parses error text.
const TOGGLE_WATCHED_ERRORS: Record<string, string> = {
    NOT_FOUND: 'That film is no longer on this list.',
    NOT_ALLOWED: 'You do not have access to this list.',
    CONFLICT: 'Someone else was updating this film. Try again.',
};

export function useToggleWatched(watchlistId: string) {
    const currentUser = useCurrentUser();
    const currentUserId = currentUser.data?.id;

    return useOptimisticMutation<{ tmdbId: string; isWatched: boolean }, WatchlistItemRecord[]>({
        queryKey: () => watchlistItemsQueryKey(watchlistId),
        mutationFn: async ({ tmdbId, isWatched }) => {
            const { data, errors } = await client.mutations.toggleWatched({
                watchlistId,
                tmdbId,
                watched: !isWatched,
            });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not update this film.');
            }
            if (!data.success) {
                throw new Error((data.error && TOGGLE_WATCHED_ERRORS[data.error]) ?? 'Could not update this film.');
            }
        },
        // Without a resolved identity there is no element to add or remove, so the cache
        // is left alone and the post-settle refetch supplies the real value.
        optimisticUpdate: (previous, { tmdbId, isWatched }) =>
            (previous ?? []).map((item) => {
                if (item.tmdbId !== tmdbId || !currentUserId) {
                    return item;
                }
                const watchedBy = watchedByIds(item);
                return {
                    ...item,
                    watchedBy: isWatched
                        ? watchedBy.filter((id) => id !== currentUserId)
                        : [...watchedBy, currentUserId],
                };
            }),
    });
}
