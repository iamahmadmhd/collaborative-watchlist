import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { watchlistItemsQueryKey } from '../../../entities/watchlist/api/watchlist-items';
import type { WatchlistItemRecord } from '../../../entities/watchlist/model/watchlist';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import { rankAfter } from '../../../shared/lib/fractional-rank';

function membershipQueryKey(watchlistId: string, tmdbId: string) {
    return ['watchlist-item-membership', watchlistId, tmdbId];
}

// FR-ITEM-1/FR-ITEM-4: a new item needs the parent's current ownerId/editors/
// viewers to stamp onto itself (§4.4, ADR-001 — permission-fanout/handler.ts's
// header explains why ownerId must be folded into `editors` here, not just
// copied verbatim) and the current last position to append after (ADR-006).
// Read fresh via the API rather than the TanStack Query cache: this mutation
// is reachable from the movie-detail "add to list" menu, which may run before
// /lists/:id has ever been opened for this particular list, so neither
// entities/watchlist cache entry is guaranteed to exist yet.
async function loadWatchlistContext(watchlistId: string) {
    const [{ data: watchlist }, { data: items }] = await Promise.all([
        client.models.Watchlist.get({ id: watchlistId }),
        client.models.WatchlistItem.list({ watchlistId }),
    ]);
    if (!watchlist) {
        throw new Error('This watchlist no longer exists.');
    }
    const lastPosition = items.reduce<string | null>(
        (max, item) => (max === null || item.position > max ? item.position : max),
        null,
    );
    return { watchlist, lastPosition };
}

// Backs the add-to-list menu's per-row checked state (FR-ITEM-2's own
// enforcement is the composite-key conditional write on create — this is
// purely "what should the checkbox show", read via a point read on the same
// composite key). `enabled` lets callers defer the query until the menu
// holding this row is actually open, rather than firing one point read per
// eligible watchlist on every Movie Detail page view.
export function useIsMovieInWatchlist(watchlistId: string, tmdbId: string, enabled: boolean) {
    return useQuery({
        queryKey: membershipQueryKey(watchlistId, tmdbId),
        queryFn: async (): Promise<boolean> => {
            const { data } = await client.models.WatchlistItem.get({ watchlistId, tmdbId });
            return data !== null;
        },
        enabled,
    });
}

// FR-ITEM-1 (add) / FR-ITEM-3 (remove), one mutation toggling the same
// membership point-read cache (§7.2's optimistic onMutate/onError/onSettled,
// mirrored from features/save-movie's useToggleSave). Deliberately does NOT
// hand-patch entities/watchlist's watchlistItemsQueryKey cache: if /lists/:id
// happens to be open for this same list in another tab, the real-time
// subscription already wired into useWatchlistItems (§2.4) picks up this
// create/delete on its own — patching both caches here would just be a second,
// racier path to the same result.
export function useToggleListItem(watchlistId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ movie, isMember }: { movie: MovieSummary; isMember: boolean }) => {
            if (isMember) {
                const { errors } = await client.models.WatchlistItem.delete({ watchlistId, tmdbId: movie.tmdbId });
                if (errors?.length) {
                    throw new Error(errors[0]?.message ?? 'Could not remove this film from the list.');
                }
                return;
            }

            const [{ userId }, { watchlist, lastPosition }] = await Promise.all([
                getCurrentUser(),
                loadWatchlistContext(watchlistId),
            ]);

            const { errors } = await client.models.WatchlistItem.create({
                watchlistId,
                tmdbId: movie.tmdbId,
                title: movie.title,
                posterPath: movie.posterPath ?? null,
                releaseYear: movie.releaseYear ?? null,
                addedBy: userId,
                addedAt: new Date().toISOString(),
                position: rankAfter(lastPosition),
                editors: [watchlist.ownerId, ...(watchlist.editors ?? [])],
                viewers: watchlist.viewers ?? [],
            });
            // FR-ITEM-2's actual enforcement is the composite key's implicit
            // attribute_not_exists condition (§5.1) — a duplicate add surfaces here
            // as a generic AppSync conditional-check error, not a typed result.
            if (errors?.length) {
                throw new Error(errors[0]?.message ?? 'Could not add this film to the list.');
            }
        },
        onMutate: async ({ movie, isMember }) => {
            const queryKey = membershipQueryKey(watchlistId, movie.tmdbId);
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<boolean>(queryKey);
            queryClient.setQueryData<boolean>(queryKey, !isMember);
            return { previous, queryKey };
        },
        onError: (_err, _vars, context) => {
            if (context) {
                queryClient.setQueryData(context.queryKey, context.previous);
            }
        },
        onSettled: (_data, _err, { movie }) => {
            void queryClient.invalidateQueries({ queryKey: membershipQueryKey(watchlistId, movie.tmdbId) });
        },
    });
}

// FR-ITEM-3, for /lists/:id's own item rows — unlike the add-to-list menu
// above, the items array IS what's on screen here, so this optimistically
// mutates entities/watchlist's own watchlistItemsQueryKey list directly
// (§7.2) rather than a separate membership flag.
export function useRemoveListItem(watchlistId: string) {
    const queryClient = useQueryClient();
    const queryKey = watchlistItemsQueryKey(watchlistId);

    return useMutation({
        mutationFn: async (tmdbId: string) => {
            const { errors } = await client.models.WatchlistItem.delete({ watchlistId, tmdbId });
            if (errors?.length) {
                throw new Error(errors[0]?.message ?? 'Could not remove this film from the list.');
            }
        },
        onMutate: async (tmdbId) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<WatchlistItemRecord[]>(queryKey);
            queryClient.setQueryData<WatchlistItemRecord[]>(queryKey, (old) =>
                (old ?? []).filter((item) => item.tmdbId !== tmdbId),
            );
            return { previous };
        },
        onError: (_err, _tmdbId, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKey, context.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });
}
