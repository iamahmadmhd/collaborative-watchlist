import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import { watchlistItemsQueryKey } from '../../../entities/watchlist/api/watchlist-items';
import type { WatchlistItemRecord } from '../../../entities/watchlist/model/watchlist';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import { rankAfter } from '../../../shared/lib/fractional-rank';
import { useOptimisticMutation } from '../../../shared/lib/use-optimistic-mutation';

function membershipQueryKey(watchlistId: string, tmdbId: string) {
    return ['watchlist-item-membership', watchlistId, tmdbId];
}

// FR-ITEM-4 (ADR-006): a new item appends after the current last position.
// Read fresh via the API rather than the TanStack Query cache — this mutation is
// reachable from the movie-detail "add to list" menu, which may run before
// /lists/:id has ever been opened for this particular list, so the
// entities/watchlist cache entry is not guaranteed to exist yet.
//
// The parent's ownerId/editors/viewers are NOT read here any more. They used to
// be, so the client could stamp them onto the new item (ADR-001's denormalised
// arrays) — which meant the permission arrays on a brand-new item were whatever
// the caller sent, and the generated create resolver had no way to check them
// against the parent. addWatchlistItem's handler reads the Watchlist server-side
// and stamps them itself (§4.4, NFR-SEC-1); nothing about them belongs on this
// side of the wire.
async function loadLastPosition(watchlistId: string): Promise<string | null> {
    const { data: items } = await client.models.WatchlistItem.list({ watchlistId });
    return items.reduce<string | null>(
        (max, item) => (max === null || item.position > max ? item.position : max),
        null,
    );
}

// addWatchlistItem returns a typed rejection rather than a GraphQL error string,
// the same shape as the membership mutations (System Design §2.5's reasoning: the
// client should not have to parse error text to tell these apart).
const ADD_ITEM_ERRORS: Record<string, string> = {
    NOT_FOUND: 'This watchlist no longer exists.',
    NOT_ALLOWED: 'You do not have permission to add films to this list.',
    ALREADY_IN_LIST: 'That film is already on this list.',
};

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
// membership point-read cache (§7.2's optimistic update, via
// shared/lib/use-optimistic-mutation.ts — the query key here depends on which
// movie was toggled, which is exactly the per-variables key case that helper
// exists for). Deliberately does NOT hand-patch entities/watchlist's
// watchlistItemsQueryKey cache: if /lists/:id happens to be open for this same
// list in another tab, the real-time subscription already wired into
// useWatchlistItems (§2.4) picks up this create/delete on its own — patching
// both caches here would just be a second, racier path to the same result.
export function useToggleListItem(watchlistId: string) {
    return useOptimisticMutation<{ movie: MovieSummary; isMember: boolean }, boolean>({
        queryKey: ({ movie }) => membershipQueryKey(watchlistId, movie.tmdbId),
        mutationFn: async ({ movie, isMember }) => {
            if (isMember) {
                const { errors } = await client.models.WatchlistItem.delete({ watchlistId, tmdbId: movie.tmdbId });
                if (errors?.length) {
                    throw new Error(errors[0]?.message ?? 'Could not remove this film from the list.');
                }
                return;
            }

            const lastPosition = await loadLastPosition(watchlistId);

            // addedBy/addedAt are stamped server-side from the caller's own token,
            // so they are not sent — nor are editors/viewers (see loadLastPosition).
            const { data, errors } = await client.mutations.addWatchlistItem({
                watchlistId,
                tmdbId: movie.tmdbId,
                title: movie.title,
                posterPath: movie.posterPath ?? null,
                releaseYear: movie.releaseYear ?? null,
                position: rankAfter(lastPosition),
            });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not add this film to the list.');
            }
            // FR-ITEM-2's actual enforcement is still the composite key's implicit
            // attribute_not_exists condition (§5.1); the handler just maps that
            // conditional-check failure to ALREADY_IN_LIST on its way back.
            if (!data.success) {
                throw new Error((data.error && ADD_ITEM_ERRORS[data.error]) ?? 'Could not add this film to the list.');
            }
        },
        optimisticUpdate: (_previous, { isMember }) => !isMember,
    });
}

// FR-ITEM-3, for /lists/:id's own item rows — unlike the add-to-list menu
// above, the items array IS what's on screen here, so this optimistically
// mutates entities/watchlist's own watchlistItemsQueryKey list directly
// (§7.2) rather than a separate membership flag.
export function useRemoveListItem(watchlistId: string) {
    return useOptimisticMutation<string, WatchlistItemRecord[]>({
        queryKey: () => watchlistItemsQueryKey(watchlistId),
        mutationFn: async (tmdbId) => {
            const { errors } = await client.models.WatchlistItem.delete({ watchlistId, tmdbId });
            if (errors?.length) {
                throw new Error(errors[0]?.message ?? 'Could not remove this film from the list.');
            }
        },
        optimisticUpdate: (previous, tmdbId) => (previous ?? []).filter((item) => item.tmdbId !== tmdbId),
    });
}
