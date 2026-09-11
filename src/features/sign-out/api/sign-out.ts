import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from 'aws-amplify/auth';

// `global` revokes every refresh token for this member rather than just the current
// device, which is what Settings' "sign out everywhere" row uses.
//
// Clearing the query cache matters beyond this session: without it, the next member to
// sign in on this browser would see the previous one's cached data flash on screen.
export function useSignOut() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (global: boolean) => {
            await signOut({ global });
        },
        onSuccess: () => {
            queryClient.clear();
        },
    });
}
