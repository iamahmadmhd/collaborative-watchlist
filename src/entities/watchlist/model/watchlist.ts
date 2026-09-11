import type { Schema } from '../../../../amplify/data/resource';

// Types come straight from the Amplify Data schema; re-declaring them by hand would be
// a second, driftable copy.
export type WatchlistRecord = Schema['Watchlist']['type'];
export type WatchlistMemberRecord = Schema['WatchlistMember']['type'];
export type WatchlistItemRecord = Schema['WatchlistItem']['type'];
export type WatchlistRole = NonNullable<WatchlistMemberRecord['role']>;

// Only these two roles may write to a list's items or metadata. Centralised so every
// caller checks the same set rather than re-deriving it.
export function canEditWatchlist(role: WatchlistRole | null | undefined): boolean {
    return role === 'OWNER' || role === 'EDITOR';
}
