import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { PaginatedMovies } from '../model/movie';

// Trending and genre-filtered discovery are one query: the branch on genreIds lives
// server-side, and this hook only forwards the argument.
export function useDiscoverMovies({ genreId, page }: { genreId?: number | undefined; page: number }) {
    return useQuery({
        queryKey: ['discover-movies', genreId ?? null, page],
        queryFn: async (): Promise<PaginatedMovies> => {
            const { data, errors } = await client.queries.discoverMovies(
                genreId !== undefined ? { genreIds: [genreId], page } : { page },
            );
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not load movies.');
            }
            return data;
        },
        placeholderData: keepPreviousData,
    });
}
