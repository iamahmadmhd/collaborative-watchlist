import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

// The shared onMutate/onError/onSettled scaffold: cancel in-flight fetches, snapshot
// the cache entry, write optimistically, restore on failure, refetch once settled.
//
// `queryKey` takes the mutation's variables because one caller needs a key that depends
// on which movie was toggled, so every caller supplies a function even when its own key
// never varies.
//
// `context.previous` is restored unconditionally rather than behind `if (previous)`:
// for a boolean TData a legitimate `false` would otherwise be skipped as falsy, and
// setQueryData(key, undefined) is already a no-op for the nothing-cached case.
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
