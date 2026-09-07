import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { Genre } from '../model/movie';

// Matches the TmdbCache TTL for the `genres` key (System Design §5.5, 7 days) —
// the list barely changes, no reason to refetch it more often than the server
// cache itself would return anything new.
const GENRES_STALE_TIME = 7 * 24 * 60 * 60 * 1000;

export function useGenres() {
    return useQuery({
        queryKey: ['genres'],
        queryFn: async (): Promise<Genre[]> => {
            const { data, errors } = await client.queries.getGenres({});
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not load genres.');
            }
            // The generated return type allows null array entries even though this
            // query never actually produces one (Genre's fields are all required)
            // — narrow it here rather than let `null` leak into every caller.
            return data.filter((genre): genre is Genre => genre != null);
        },
        staleTime: GENRES_STALE_TIME,
    });
}
