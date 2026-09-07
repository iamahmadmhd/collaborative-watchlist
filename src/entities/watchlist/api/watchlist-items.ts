import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistItemRecord } from '../model/watchlist';

export function watchlistItemsQueryKey(watchlistId: string) {
    return ['watchlist-items', watchlistId];
}

// §5.3: fractional-rank strings sort correctly under plain string comparison
// — "Items sort in memory, so no index is required for ordering."
function sortByPosition(items: WatchlistItemRecord[]): WatchlistItemRecord[] {
    return [...items].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

function upsertItem(items: WatchlistItemRecord[] | undefined, item: WatchlistItemRecord): WatchlistItemRecord[] {
    // Keyed on tmdbId, not a server-generated id: WatchlistItem's own identifier
    // (watchlistId, tmdbId — data/resource.ts) is known client-side the instant a
    // movie is picked, so unlike the general "temp id -> server id" case §2.4
    // describes, there is no id to swap here. An upsert-by-tmdbId is already
    // self-echo-safe: our own optimistic write and the subscription event that
    // echoes it back both resolve to the same key, so the second one overwrites
    // the first with equivalent data instead of appending a duplicate row.
    const withoutExisting = (items ?? []).filter((existing) => existing.tmdbId !== item.tmdbId);
    return sortByPosition([...withoutExisting, item]);
}

function removeItem(items: WatchlistItemRecord[] | undefined, tmdbId: string): WatchlistItemRecord[] {
    return (items ?? []).filter((existing) => existing.tmdbId !== tmdbId);
}

// System Design §5.2 access pattern 4 (items in list -> WatchlistItem PK query)
// plus §2.4's real-time integration in full:
//   - subscription opens on mount, closes on unmount (the effect below, scoped
//     to this hook's own lifecycle — its one caller is the /lists/:id page)
//   - filtered by watchlistId, never a global stream (FR-SYNC-2)
//   - three writers into one cache entry: initial list() here, optimistic
//     writes from features/manage-list-items' onMutate, and these subscription
//     events — all keyed by watchlistItemsQueryKey(watchlistId)
//   - on subscription interruption (the observable's error callback), refetch
//     rather than assume continuity (FR-SYNC-5)
export function useWatchlistItems(watchlistId: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: watchlistItemsQueryKey(watchlistId),
        queryFn: async (): Promise<WatchlistItemRecord[]> => {
            const { data } = await client.models.WatchlistItem.list({ watchlistId });
            return sortByPosition(data);
        },
    });

    useEffect(() => {
        const queryKey = watchlistItemsQueryKey(watchlistId);
        const filter = { watchlistId: { eq: watchlistId } };

        function reconcile() {
            void queryClient.invalidateQueries({ queryKey });
        }

        const subscriptions = [
            client.models.WatchlistItem.onCreate({ filter }).subscribe({
                next: (item) =>
                    queryClient.setQueryData<WatchlistItemRecord[]>(queryKey, (old) => upsertItem(old, item)),
                error: reconcile,
            }),
            client.models.WatchlistItem.onUpdate({ filter }).subscribe({
                next: (item) =>
                    queryClient.setQueryData<WatchlistItemRecord[]>(queryKey, (old) => upsertItem(old, item)),
                error: reconcile,
            }),
            client.models.WatchlistItem.onDelete({ filter }).subscribe({
                next: (item) =>
                    queryClient.setQueryData<WatchlistItemRecord[]>(queryKey, (old) => removeItem(old, item.tmdbId)),
                error: reconcile,
            }),
        ];

        return () => {
            subscriptions.forEach((subscription) => subscription.unsubscribe());
        };
    }, [watchlistId, queryClient]);

    return query;
}
