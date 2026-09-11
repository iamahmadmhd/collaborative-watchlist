import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';

// NFR-COMP-2. Two steps, in this order and no other: the deleteAccount mutation
// (amplify/functions/delete-account) does all the DynamoDB cleanup (profile, saved
// films, watched records, owned watchlists cascaded, other memberships left) FIRST,
// and only once that succeeds does this call aws-amplify/auth's deleteUser() — the
// member's own self-service Cognito deletion (their own access token, no admin IAM
// grant needed) — to remove the account itself and sign out.
//
// If deleteAccount throws, deleteUser() is never called: the member is still a
// valid, signed-in account with (at worst) partially-cleaned data, and Settings'
// retry is simply calling this mutation again — every step on the backend is
// idempotent against a partial prior run (see delete-account/handler.ts). The
// reverse ordering would risk the opposite: a member permanently signed out with
// orphaned data and no way to retry through the UI at all.
//
// queryClient.clear() on success, same reasoning as useSignOut — deleteUser()
// itself calls Amplify's signOut() internally, so without clearing the cache the
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
