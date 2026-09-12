import { useQuery } from '@tanstack/react-query';
import { fetchUserAttributes } from 'aws-amplify/auth';

// Reads Cognito directly rather than UserProfile: that model deliberately carries no
// email field, so a member's own email has nowhere else to come from.
export function useCurrentUserEmail() {
    return useQuery({
        queryKey: ['current-user-email'],
        queryFn: async (): Promise<string | null> => {
            const attributes = await fetchUserAttributes();
            return attributes.email ?? null;
        },
        staleTime: 5 * 60_000,
    });
}
