import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { PaginatedMovies } from '../model/movie';

// `enabled` holds the request back on an empty query: that is the Search screen's
// initial and cleared state, not a valid search.
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
        placeholderData: keepPreviousData,
    });
}
