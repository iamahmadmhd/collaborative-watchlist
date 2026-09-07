import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRole } from '../model/watchlist';

// System Design §5.2 access pattern 7 ("my role" — a genuine point read
// thanks to WatchlistMember's composite key) and CLAUDE.md's Authorization
// section: this is the presentational-only permission hook. It runs on every
// render of the detail page to decide which controls to show, but it is
// never the control — AppSync's field-/owner-level rules (data/resource.ts)
// reject the underlying mutations regardless of what this hook returns
// (NFR-SEC-1). `null` covers both "not yet loaded" and "not a member of this
// list" — callers that need to tell those apart use `.isPending` alongside it.
export function useWatchlistRole(watchlistId: string) {
    return useQuery({
        queryKey: ['watchlist-role', watchlistId],
        queryFn: async (): Promise<WatchlistRole | null> => {
            const { userId } = await getCurrentUser();
            const { data } = await client.models.WatchlistMember.get({ watchlistId, userId });
            return data?.role ?? null;
        },
    });
}
