import { useQuery } from '@tanstack/react-query';
import { client } from '../../../shared/lib/amplify-client';
import type { WatchlistRole } from '../model/watchlist';

export interface WatchlistMemberWithProfile {
    userId: string;
    role: WatchlistRole;
    displayName: string | null;
    username: string | null;
}

// System Design §5.2 access pattern 6: WatchlistMember's composite key
// (watchlistId, userId) makes this a plain PK query, not a scan. WatchlistMember
// itself carries no display fields (§5.1), so each row's UserProfile is fetched
// alongside it — same Promise.all-per-membership shape use-watchlists.ts already
// uses for the mirror case (per-membership Watchlist.get()). UserProfile's
// `allow.authenticated().to(['read'])` (data/resource.ts) means any signed-in
// member can read any other member's profile, which is exactly what rendering
// a collaborator list needs.
export function useWatchlistMembers(watchlistId: string) {
    return useQuery({
        queryKey: ['watchlist-members', watchlistId],
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
