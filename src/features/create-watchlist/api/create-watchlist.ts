import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { WATCHLISTS_QUERY_KEY, toMyWatchlist, type MyWatchlist } from '../../../entities/watchlist/api/use-watchlists';

// List creation runs on the generated resolver. ownerId is the only permission field
// set here; editors/viewers are left absent rather than `[]`, which permission-fanout
// already treats as empty.
//
// The WatchlistMember(OWNER) row is not created here and cannot be — that model has no
// user-facing write grant. permission-fanout writes it from this row's INSERT stream
// event, which is a stream-plus-Lambda hop behind this mutation. Invalidating /lists
// here would race that hop and refetch a byUser index that does not have the new list
// yet, so the cache is seeded directly instead: create()'s own response carries every
// field the screen needs, and the caller is deterministically the Owner.
export function useCreateWatchlist() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ name, description }: { name: string; description: string }) => {
            const { userId } = await getCurrentUser();
            const { data, errors } = await client.models.Watchlist.create({
                name,
                description: description || null,
                ownerId: userId,
            });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not create watchlist.');
            }
            return data;
        },
        onSuccess: (watchlist) => {
            queryClient.setQueryData<MyWatchlist[]>(WATCHLISTS_QUERY_KEY, (old) => [
                ...(old ?? []),
                toMyWatchlist(watchlist, 'OWNER'),
            ]);
        },
    });
}
