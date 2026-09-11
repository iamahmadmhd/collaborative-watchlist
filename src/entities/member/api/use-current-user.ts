import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { CurrentUser } from '../model/member';

// UserProfile is server state, so this is a query hook rather than a context provider:
// getCurrentUser() resolves from Amplify's in-memory session, and UserProfile.get() is
// a point read. username/displayName stay null until claim-username runs, and callers
// pick their own fallback.
export const CURRENT_USER_QUERY_KEY = ['current-user'];

export function useCurrentUser() {
    return useQuery({
        queryKey: CURRENT_USER_QUERY_KEY,
        queryFn: async (): Promise<CurrentUser> => {
            const { userId } = await getCurrentUser();
            const { data } = await client.models.UserProfile.get({ id: userId });
            return {
                id: userId,
                username: data?.username ?? null,
                displayName: data?.displayName ?? null,
                avatarUrl: data?.avatarUrl ?? null,
                joinedAt: data?.createdAt ?? null,
            };
        },
        staleTime: 5 * 60_000,
    });
}
