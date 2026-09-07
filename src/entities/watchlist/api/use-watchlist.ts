import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRecord } from '../model/watchlist';

export function watchlistQueryKey(watchlistId: string) {
    return ['watchlist', watchlistId];
}

// /lists/:id header (name, description, itemCount per FR-LIST-6) plus the
// ownerId/editors/viewers this watchlist's items get copied from at creation
// (§4.4, ADR-001) — features/manage-list-items reads those off this same
// cache entry rather than issuing a second Watchlist.get(). A non-member gets
// `data: null` back (Watchlist's authorization has no rule matching them),
// which the page renders as "not found" rather than crashing.
export function useWatchlist(watchlistId: string) {
    return useQuery({
        queryKey: watchlistQueryKey(watchlistId),
        queryFn: async (): Promise<WatchlistRecord | null> => {
            const { data } = await client.models.Watchlist.get({ id: watchlistId });
            return data;
        },
    });
}
