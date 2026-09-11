import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';

// Two steps, in this order only: the deleteAccount mutation cleans up DynamoDB first,
// and only on success does deleteUser() remove the Cognito account. If the mutation
// throws, deleteUser() never runs and the member — still signed in — can retry, since
// every backend step is idempotent. The reverse order would strand them signed out
// with orphaned data.
//
// queryClient.clear() on success: deleteUser() signs out internally, so without it the
// next visitor on this browser would see the deleted member's data flash on screen.
export function useDeleteAccount() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data, errors } = await client.mutations.deleteAccount({});
            if (errors?.length || !data?.success) {
                throw new Error(errors?.[0]?.message ?? 'Could not delete your account.');
            }
            await deleteUser();
        },
        onSuccess: () => {
            queryClient.clear();
        },
    });
}
