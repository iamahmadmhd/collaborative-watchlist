import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { Genre } from '../model/movie';

// Matches the server cache's 7-day TTL for genres — refetching sooner cannot return
// anything new.
const GENRES_STALE_TIME = 7 * 24 * 60 * 60 * 1000;

export function useGenres() {
    return useQuery({
        queryKey: ['genres'],
        queryFn: async (): Promise<Genre[]> => {
            const { data, errors } = await client.queries.getGenres({});
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not load genres.');
            }
            // The generated return type allows null entries this query never produces;
            // narrowed here rather than left to leak into every caller.
            return data.filter((genre): genre is Genre => genre != null);
        },
        staleTime: GENRES_STALE_TIME,
    });
}
