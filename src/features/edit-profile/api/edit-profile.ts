import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { CURRENT_USER_QUERY_KEY } from '../../../entities/member/api/use-current-user';

// FR-AUTH-5's display-name half, as an ongoing edit rather than the one-time write
// claim-username/api/claim-username.ts makes alongside the username claim itself.
// A plain UserProfile.update() against the model's own owner-write rule
// (data/resource.ts: `allow.owner().to(['read', 'update'])`) — no dedicated Lambda
// needed, unlike username (which has to go through the atomic conditional write in
// claim-username for FR-AUTH-4's uniqueness guarantee). Renaming yourself carries
// no such uniqueness constraint.
export function useUpdateDisplayName() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (displayName: string) => {
            const { userId } = await getCurrentUser();
            const { data, errors } = await client.models.UserProfile.update({ id: userId, displayName });
            if (errors?.length || !data) {
                throw new Error(errors?.[0]?.message ?? 'Could not update your display name.');
            }
            return data;
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
        },
    });
}
