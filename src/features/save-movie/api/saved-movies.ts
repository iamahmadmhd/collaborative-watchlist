import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { useOptimisticMutation } from '../../../shared/lib/use-optimistic-mutation';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import type { Schema } from '../../../../amplify/data/resource';

export type SavedMovieRecord = Schema['SavedMovie']['type'];

// Per-card save-state would be one point read per grid card, so the whole saved set is
// fetched once into a Set and checked in memory. allow.owner() scopes list() to the
// caller's own rows server-side, so no userId filter is needed.
const SAVED_MOVIES_KEY = ['saved-movies'];

export function useSavedSet() {
    return useQuery({
        queryKey: SAVED_MOVIES_KEY,
        queryFn: async (): Promise<Set<string>> => {
            const { data } = await client.models.SavedMovie.list();
            return new Set(data.map((saved) => saved.tmdbId));
        },
    });
}

// Resolves through the byUserAndDate index rather than list()-plus-sort, so
// newest-first is a query-time guarantee. The index's partition key must be supplied
// explicitly, unlike list(), though allow.owner() still scopes it to the caller.
export function useSavedMovies() {
    return useQuery({
        queryKey: [...SAVED_MOVIES_KEY, 'list'],
        queryFn: async (): Promise<SavedMovieRecord[]> => {
            const { userId } = await getCurrentUser();
            const { data } = await client.models.SavedMovie.listSavedMovieByUserIdAndSavedAt(
                { userId },
                { sortDirection: 'DESC' },
            );
            return data;
        },
    });
}

// Optimistic with rollback: a failed save must not leave the badge lying about the
// server's state.
export function useToggleSave() {
    return useOptimisticMutation<{ movie: MovieSummary; isSaved: boolean }, Set<string>>({
        queryKey: () => SAVED_MOVIES_KEY,
        mutationFn: async ({ movie, isSaved }) => {
            const { userId } = await getCurrentUser();
            if (isSaved) {
                await client.models.SavedMovie.delete({ userId, tmdbId: movie.tmdbId });
            } else {
                await client.models.SavedMovie.create({
                    userId,
                    tmdbId: movie.tmdbId,
                    title: movie.title,
                    posterPath: movie.posterPath ?? null,
                    releaseYear: movie.releaseYear ?? null,
                    savedAt: new Date().toISOString(),
                });
            }
        },
        optimisticUpdate: (previous, { movie, isSaved }) => {
            const next = new Set(previous);
            if (isSaved) {
                next.delete(movie.tmdbId);
            } else {
                next.add(movie.tmdbId);
            }
            return next;
        },
    });
}
