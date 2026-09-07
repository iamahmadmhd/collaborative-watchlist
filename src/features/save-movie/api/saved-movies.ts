import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { MovieSummary } from '../../../entities/movie/model/movie';

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

// FR-SAVE-1/2. Optimistic onMutate/onError/onSettled with rollback (System
// Design §7.2) — a save/unsave failure must not leave the badge lying about
// the server's actual state.
export function useToggleSave() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ movie, isSaved }: { movie: MovieSummary; isSaved: boolean }) => {
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
        onMutate: async ({ movie, isSaved }) => {
            await queryClient.cancelQueries({ queryKey: SAVED_MOVIES_KEY });
            const previous = queryClient.getQueryData<Set<string>>(SAVED_MOVIES_KEY);
            queryClient.setQueryData<Set<string>>(SAVED_MOVIES_KEY, (old) => {
                const next = new Set(old);
                if (isSaved) {
                    next.delete(movie.tmdbId);
                } else {
                    next.add(movie.tmdbId);
                }
                return next;
            });
            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(SAVED_MOVIES_KEY, context.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: SAVED_MOVIES_KEY });
        },
    });
}
