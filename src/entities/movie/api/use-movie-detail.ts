import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { CastMember, Genre, MovieDetail } from '../model/movie';

// Narrower than the generated `MovieDetail`: its `genres`/`cast` fields allow
// a null array or a null entry (Amplify Gen2 customType fields are nullable
// unless `.required()`'d — amplify/data/resource.ts doesn't), even though
// tmdb-schemas.ts's `toMovieDetail` never actually produces one. This is the
// type every caller of the hook below should use instead.
export type NormalizedMovieDetail = Omit<MovieDetail, 'genres' | 'cast'> & {
    genres: Genre[];
    cast: CastMember[];
};

// FR-DISC-4.
export function useMovieDetail(tmdbId: string) {
    return useQuery({
        queryKey: ['movie-detail', tmdbId],
        queryFn: async (): Promise<NormalizedMovieDetail> => {
            const { data, errors } = await client.queries.getMovieDetails({ tmdbId });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not load movie details.');
            }
            return {
                ...data,
                genres: (data.genres ?? []).filter((genre): genre is Genre => genre != null),
                cast: (data.cast ?? []).filter((castMember): castMember is CastMember => castMember != null),
            };
        },
    });
}
