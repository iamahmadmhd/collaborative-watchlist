import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistItemRecord } from '../model/watchlist';

export function watchlistItemsQueryKey(watchlistId: string) {
    return ['watchlist-items', watchlistId];
}

// Fractional-rank strings sort correctly under plain string comparison, so ordering
// needs no index.
function sortByPosition(items: WatchlistItemRecord[]): WatchlistItemRecord[] {
    return [...items].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

function upsertItem(items: WatchlistItemRecord[] | undefined, item: WatchlistItemRecord): WatchlistItemRecord[] {
    // Keyed on tmdbId rather than a server-generated id: WatchlistItem's identifier is
    // known client-side the instant a movie is picked, so there is no temporary id to
    // swap. That makes the upsert self-echo-safe on its own — the optimistic write and
    // the subscription event echoing it back resolve to the same key.
    const withoutExisting = (items ?? []).filter((existing) => existing.tmdbId !== item.tmdbId);
    return sortByPosition([...withoutExisting, item]);
}

function removeItem(items: WatchlistItemRecord[] | undefined, tmdbId: string): WatchlistItemRecord[] {
    return (items ?? []).filter((existing) => existing.tmdbId !== tmdbId);
}

// The items query plus the real-time integration described in System Design §2.4: the
// subscription opens on mount and closes on unmount, filtered by watchlistId rather
// than global; three writers feed one cache entry (this list(), optimistic writes from
// features/manage-list-items, and inbound events); an interruption refetches rather
// than assuming continuity.
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
