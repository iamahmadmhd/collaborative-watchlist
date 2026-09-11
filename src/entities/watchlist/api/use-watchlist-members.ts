import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRole } from '../model/watchlist';

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
            const { data: members } = await client.models.WatchlistMember.list({ watchlistId });

            const withProfiles = await Promise.all(
                members.map(async (member): Promise<WatchlistMemberWithProfile | null> => {
                    if (!member.role) {
                        return null;
                    }
                    const { data: profile } = await client.models.UserProfile.get({ id: member.userId });
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
