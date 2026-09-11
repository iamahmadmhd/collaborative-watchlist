import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRecord } from '../model/watchlist';

export function watchlistQueryKey(watchlistId: string) {
    return ['watchlist', watchlistId];
}

// Backs the /lists/:id header. A non-member gets `data: null` back — Watchlist's
// authorization has no rule matching them — which the page renders as "not found".
export function useWatchlist(watchlistId: string) {
    return useQuery({
        queryKey: watchlistQueryKey(watchlistId),
        queryFn: async (): Promise<WatchlistRecord | null> => {
            const { data } = await client.models.Watchlist.get({ id: watchlistId });
            return data;
        },
    });
}
