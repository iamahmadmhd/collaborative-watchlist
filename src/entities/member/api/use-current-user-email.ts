import { useQuery } from '@tanstack/react-query';
import { fetchUserAttributes } from 'aws-amplify/auth';

// FR-AUTH-7 forbids exposing a member's email to any OTHER member — it says nothing
// about a member seeing their own, which Settings' "used for sign-in codes only" row
// (docs/design/Settings.dc.html) needs. That's why this reads Cognito directly via
// aws-amplify/auth rather than UserProfile: data/resource.ts deliberately has no
// email field on that model at all ("email is intentionally NOT a field here — never
// expose it"), so there is nowhere else this could come from.
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
