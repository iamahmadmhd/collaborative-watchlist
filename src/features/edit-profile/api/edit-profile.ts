import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';
import { CURRENT_USER_QUERY_KEY } from '../../../entities/member/api/use-current-user';

// A plain UserProfile.update() against the model's own owner-write rule. Unlike the
// username, a display name carries no uniqueness constraint, so it needs no Lambda.
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
