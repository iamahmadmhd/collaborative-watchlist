import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import type { CurrentUser } from '../model/member';

// Session state is owned by Amplify Auth (CLAUDE.md state-ownership table);
// UserProfile itself is server state, so this is a TanStack Query hook, not a
// context provider — `getCurrentUser()` resolves from Amplify's own in-memory
// session cache (no network round trip beyond what Auth already did), and
// UserProfile.get() is a real point read. `username`/`displayName` are
// nullable on the model until claim-username runs (ADR-011) — callers decide
// their own fallback rather than this hook inventing one.
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
