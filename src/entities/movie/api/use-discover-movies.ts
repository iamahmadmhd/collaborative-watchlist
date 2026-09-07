import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { PaginatedMovies } from '../model/movie';

// FR-DISC-1 (trending, no filter) / FR-DISC-3 (genre filter) — one query, per
// the handler.ts comment in amplify/data/resource.ts: the branch on genreIds
// presence lives server-side, this hook just forwards the argument.
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
    });
}
