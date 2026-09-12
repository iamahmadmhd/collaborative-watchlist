import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import { listAll, throwOnErrors } from '../../../shared/lib/amplify-result';
import type { WatchlistMemberRecord, WatchlistRole } from '../model/watchlist';

export interface WatchlistMemberWithProfile {
    userId: string;
    role: WatchlistRole;
    displayName: string | null;
    username: string | null;
}

// Exported so features/manage-members can patch this exact cache entry.
export function watchlistMembersQueryKey(watchlistId: string) {
    return ['watchlist-members', watchlistId];
}

// A plain PK query on WatchlistMember's composite key. That model carries no display
// fields, so each row's UserProfile is fetched alongside it.
export function useWatchlistMembers(watchlistId: string) {
    return useQuery({
        queryKey: watchlistMembersQueryKey(watchlistId),
        queryFn: async (): Promise<WatchlistMemberWithProfile[]> => {
            const members = await listAll<WatchlistMemberRecord>(
                (nextToken) => client.models.WatchlistMember.list({ watchlistId, nextToken }),
                'Could not load this list’s members.',
            );

            const withProfiles = await Promise.all(
                members.map(async (member): Promise<WatchlistMemberWithProfile | null> => {
                    if (!member.role) {
                        return null;
                    }
                    const { data: profile, errors } = await client.models.UserProfile.get({ id: member.userId });
                    throwOnErrors(errors, 'Could not load this list’s members.');
                    return {
                        userId: member.userId,
                        role: member.role,
                        displayName: profile?.displayName ?? null,
                        username: profile?.username ?? null,
                    };
                }),
            );

            return withProfiles.filter((member): member is WatchlistMemberWithProfile => member !== null);
        },
    });
}
