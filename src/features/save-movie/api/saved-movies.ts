import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { useOptimisticMutation } from '../../../shared/lib/use-optimistic-mutation';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import type { Schema } from '../../../../amplify/data/resource';

export type SavedMovieRecord = Schema['SavedMovie']['type'];

// System Design §5.2 access pattern 2: per-card save-state lookup would be one
// point read per grid card (20 per scroll); instead the whole saved set is
// fetched once into a Set and checked in memory. `allow.owner()` on SavedMovie
// (amplify/data/resource.ts) scopes `.list()` to the caller's own rows server-side
// — no explicit userId filter needed here.
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

// FR-SAVE-3, System Design §5.2 access pattern 1: the dedicated /saved view
// resolves through the byUserAndDate secondary index (amplify/data/resource.ts)
// rather than list()+client-sort — newest-first is a query-time guarantee, not
// an afterthought. `allow.owner()` still scopes the index to the caller's own
// rows; the index's partition key (userId) must be supplied explicitly here,
// unlike list().
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

// FR-SAVE-1/2. Optimistic update with rollback (System Design §7.2, via
// shared/lib/use-optimistic-mutation.ts) — a save/unsave failure must not leave
// the badge lying about the server's actual state.
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
