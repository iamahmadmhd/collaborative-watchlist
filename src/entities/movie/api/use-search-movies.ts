import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { PaginatedMovies } from '../model/movie';

// FR-DISC-2. Mirrors use-discover-movies.ts's shape; the one difference is
// `enabled` — an empty query string is the Search screen's initial/cleared
// state, not a valid TMDB search, so no request goes out until there's
// something to search for.
export function useSearchMovies({ query, page }: { query: string; page: number }) {
    const trimmedQuery = query.trim();

    return useQuery({
        queryKey: ['search-movies', trimmedQuery, page],
        queryFn: async (): Promise<PaginatedMovies> => {
            const { data, errors } = await client.queries.searchMovies({ query: trimmedQuery, page });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not search movies.');
            }
            return data;
        },
        enabled: trimmedQuery.length > 0,
    });
}
