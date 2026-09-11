import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRecord } from '../model/watchlist';

export function watchlistQueryKey(watchlistId: string) {
    return ['watchlist', watchlistId];
}

// /lists/:id header (name, description, itemCount per FR-LIST-6) plus the
// ownerId/editors/viewers useWatchlistRole derives the viewer's role from —
// presentationally only, per CLAUDE.md. Items no longer copy their permission
// arrays from this cache entry: addWatchlistItem's handler reads the parent
// server-side and stamps them there (§4.4, ADR-001, NFR-SEC-1). A non-member
// gets `data: null` back (Watchlist's authorization has no rule matching them),
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
