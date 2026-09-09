import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from 'aws-amplify/auth';

// FR-AUTH-6. "There is no persistent credential to reset" (SRS) — signOut() simply
// ends the current session; re-authentication issues a fresh one-time code.
// `global` maps to Amplify Auth's own global sign-out (revokes every refresh token
// for this member, not just the current device) — Settings' "sign out everywhere"
// row (docs/design/Settings.dc.html) is this same requirement, not a separate one.
//
// Clearing the query cache matters beyond this member's own session: without it,
// a different member signing in on the same browser afterward would see the
// previous member's cached watchlists/saved films/current-user flash on screen
// until each query happened to refetch.
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
