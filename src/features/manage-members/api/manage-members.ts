import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import {
    watchlistMembersQueryKey,
    type WatchlistMemberWithProfile,
} from '../../../entities/watchlist/api/use-watchlist-members';
import { watchlistRoleQueryKey } from '../../../entities/watchlist/api/use-watchlist-role';
import { WATCHLISTS_QUERY_KEY, type MyWatchlist } from '../../../entities/watchlist/api/use-watchlists';

// addMember's rejection reasons are distinct enough — a bad username, a full list, a
// caller who isn't the Owner — that the dialog needs the typed result, so unlike the
// hooks below a success:false response resolves normally here.
export function useAddMember(watchlistId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ username, role }: { username: string; role: 'EDITOR' | 'VIEWER' }) => {
            const { data, errors } = await client.mutations.addMember({ watchlistId, username, role });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not add that collaborator.');
            }
            return data;
        },
        onSuccess: (data) => {
            if (data.success) {
                void queryClient.invalidateQueries({ queryKey: watchlistMembersQueryKey(watchlistId) });
            }
        },
    });
}

function membershipErrorMessage(error: string | null | undefined): string {
    switch (error) {
        case 'CANNOT_REMOVE_OWNER':
            return 'The Owner cannot be removed from their own watchlist.';
        case 'NOT_A_MEMBER':
            return 'That member is no longer on this list.';
        case 'NOT_OWNER':
            return 'Only the Owner can do that.';
        case 'CONFLICT':
            return 'Another membership change happened at the same time — please try again.';
        default:
            return 'Could not update this watchlist’s membership.';
    }
}

// Owner-only removal of another collaborator. Optimistically drops the row, and throws
// on a logical rejection too so the rollback path also covers a stale CONFLICT from a
// concurrent membership change.
export function useRemoveMember(watchlistId: string) {
    const queryClient = useQueryClient();
    const queryKey = watchlistMembersQueryKey(watchlistId);

    return useMutation({
        mutationFn: async (userId: string) => {
            const { data, errors } = await client.mutations.removeMember({ watchlistId, userId });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not remove that collaborator.');
            }
            if (!data.success) {
                throw new Error(membershipErrorMessage(data.error));
            }
            return data;
        },
        onMutate: async (userId) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<WatchlistMemberWithProfile[]>(queryKey);
            queryClient.setQueryData<WatchlistMemberWithProfile[]>(queryKey, (old) =>
                (old ?? []).filter((member) => member.userId !== userId),
            );
            return { previous };
        },
        onError: (_err, _userId, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKey, context.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });
}

// Any collaborator but the Owner can remove themselves. Unlike removing someone else,
// the list is no longer theirs afterwards, so /lists' cache is patched directly rather
// than waiting on a refetch.
export function useLeaveWatchlist(watchlistId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, errors } = await client.mutations.leaveWatchlist({ watchlistId });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not leave this watchlist.');
            }
            if (!data.success) {
                throw new Error(membershipErrorMessage(data.error));
            }
            return data;
        },
        onSuccess: () => {
            queryClient.setQueryData<MyWatchlist[]>(WATCHLISTS_QUERY_KEY, (old) =>
                (old ?? []).filter((watchlist) => watchlist.id !== watchlistId),
            );
            void queryClient.invalidateQueries({ queryKey: watchlistRoleQueryKey(watchlistId) });
            void queryClient.invalidateQueries({ queryKey: watchlistMembersQueryKey(watchlistId) });
        },
    });
}

// Owner-only reassignment between Editor and Viewer.
export function useChangeMemberRole(watchlistId: string) {
    const queryClient = useQueryClient();
    const queryKey = watchlistMembersQueryKey(watchlistId);

    return useMutation({
        mutationFn: async ({ userId, role }: { userId: string; role: 'EDITOR' | 'VIEWER' }) => {
            const { data, errors } = await client.mutations.changeMemberRole({ watchlistId, userId, role });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not change that collaborator’s role.');
            }
            if (!data.success) {
                throw new Error(membershipErrorMessage(data.error));
            }
            return data;
        },
        onMutate: async ({ userId, role }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<WatchlistMemberWithProfile[]>(queryKey);
            queryClient.setQueryData<WatchlistMemberWithProfile[]>(queryKey, (old) =>
                (old ?? []).map((member) => (member.userId === userId ? { ...member, role } : member)),
            );
            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKey, context.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });
}
