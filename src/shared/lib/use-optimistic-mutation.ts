import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

// Shared onMutate/onError/onSettled scaffold (cancel in-flight fetches, snapshot
// the current cache entry, optimistically write the new value, restore the
// snapshot on failure, and refetch once settled — System Design §7.2), extracted
// from features/save-movie's useToggleSave, features/toggle-watched's
// useToggleWatched, and features/manage-list-items's useToggleListItem/
// useRemoveListItem, which had each hand-rolled the identical sequence.
//
// `queryKey` takes the mutation's own variables because one caller
// (useToggleListItem) needs a key that depends on which movie was toggled, not
// just the watchlist it's scoped to — a plain fixed QueryKey can't express that,
// so every caller supplies a `(variables) => QueryKey` function even when their
// own key never actually varies with the variables.
//
// Restoring `context.previous` unconditionally (rather than `if (previous)`)
// matters for TData shapes like `boolean` where a legitimate previous value
// (`false`) would otherwise be skipped as falsy; TanStack Query already treats
// `setQueryData(key, undefined)` as a no-op, so this stays correct for the
// "nothing was cached yet" case too.
export function useOptimisticMutation<TVariables, TData>({
    queryKey,
    mutationFn,
    optimisticUpdate,
}: {
    queryKey: (variables: TVariables) => QueryKey;
    mutationFn: (variables: TVariables) => Promise<void>;
    optimisticUpdate: (previous: TData | undefined, variables: TVariables) => TData;
}) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onMutate: async (variables: TVariables) => {
            const key = queryKey(variables);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<TData>(key);
            queryClient.setQueryData<TData>(key, (old) => optimisticUpdate(old, variables));
            return { previous, key };
        },
        onError: (_err, _variables, context) => {
            if (context) {
                queryClient.setQueryData(context.key, context.previous);
            }
        },
        onSettled: (_data, _err, variables) => {
            void queryClient.invalidateQueries({ queryKey: queryKey(variables) });
        },
    });
}
