import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { CastMember, Genre, MovieDetail } from '../model/movie';

// Narrower than the generated MovieDetail, whose genres/cast allow nulls the server
// never actually produces. Callers should use this type.
export type NormalizedMovieDetail = Omit<MovieDetail, 'genres' | 'cast'> & {
    genres: Genre[];
    cast: CastMember[];
};

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
