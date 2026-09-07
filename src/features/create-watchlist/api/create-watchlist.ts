import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { WATCHLISTS_QUERY_KEY, toMyWatchlist, type MyWatchlist } from '../../../entities/watchlist/api/use-watchlists';

// FR-LIST-1. Plain generated resolver — System Design §4.1 states list CRUD runs
// on Amplify's generated resolvers, no dedicated Lambda. ownerId is the only
// permission field set here; its field-level authorization (data/resource.ts)
// grants `create` to the owner only, exactly this call. editors/viewers are left
// unset rather than `[]` — Amplify Data array fields have no default, and
// permission-fanout/handler.ts already treats "absent" as "empty" for a freshly
// created Watchlist, so an explicit empty array would just be a second way of
// saying the same thing.
//
// The corresponding WatchlistMember(OWNER) row is NOT created here — it can't
// be: WatchlistMember has no user-facing write grant at all. permission-fanout
// creates it from this Watchlist row's own INSERT stream event once this write
// lands (see that function's file header, point 3), which is NOT synchronous
// with this mutation's own resolution — a DynamoDB Streams + Lambda hop, not a
// sub-second guarantee. Invalidating /lists right after create() was tried
// first and made the bug worse, not better: it raced that stream, refetched
// while the byUser index still didn't have the new list, and overwrote the
// freshly created row right back out of the cache. Seeding the cache directly
// instead sidesteps the race entirely — Watchlist.create()'s own response
// already has every field this screen needs, and the creator is deterministically
// the Owner (ownerId is set to this caller above), so nothing here depends on
// the membership row existing yet. A later natural refetch (remount, window
// focus) picks up the authoritative row once the stream has long since caught up.
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
