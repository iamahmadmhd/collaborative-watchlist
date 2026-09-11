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

// A new item appends after the current last position.
// Read fresh via the API rather than the TanStack Query cache — this mutation is
// reachable from the movie-detail "add to list" menu, which may run before
// /lists/:id has ever been opened for this particular list, so the
// entities/watchlist cache entry is not guaranteed to exist yet.
//
// The parent's permission arrays are deliberately not read here: addWatchlistItem's
// handler reads the Watchlist server-side and stamps them itself, so nothing about
// them belongs on this side of the wire.
async function loadLastPosition(watchlistId: string): Promise<string | null> {
    const { data: items } = await client.models.WatchlistItem.list({ watchlistId });
    return items.reduce<string | null>(
        (max, item) => (max === null || item.position > max ? item.position : max),
        null,
    );
}

// addWatchlistItem returns a typed rejection rather than a GraphQL error string, so
// the client never parses error text.
const ADD_ITEM_ERRORS: Record<string, string> = {
    NOT_FOUND: 'This watchlist no longer exists.',
    NOT_ALLOWED: 'You do not have permission to add films to this list.',
    ALREADY_IN_LIST: 'That film is already on this list.',
};

// Backs the add-to-list menu's per-row checked state via a point read on the same
// composite key. `enabled` defers it until the menu is open, rather than firing one
// point read per eligible watchlist on every Movie Detail view.
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

// One mutation toggling the membership point-read cache. It deliberately does not also
// patch the items cache: if /lists/:id is open for the same list, its subscription
// already picks this up, and patching both would be a second, racier path.
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

            // addedBy/addedAt are stamped server-side from the caller's token, so they
            // are not sent — nor are editors/viewers.
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
            // Duplicate prevention is the composite key's implicit attribute_not_exists
            // condition; the handler maps that failure to ALREADY_IN_LIST.
            if (!data.success) {
                throw new Error((data.error && ADD_ITEM_ERRORS[data.error]) ?? 'Could not add this film to the list.');
            }
        },
        optimisticUpdate: (_previous, { isMember }) => !isMember,
    });
}

// For /lists/:id's own item rows. Unlike the add-to-list menu above, the items array
// is what's on screen, so this patches that list directly rather than a membership flag.
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
