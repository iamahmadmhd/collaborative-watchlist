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

// watchedBy is typed `(string | null)[] | null` by the generated schema — an Amplify
// array field has no default, so an item nobody has marked carries no attribute at all.
// Every reader goes through these two so that coalescing happens in one place.
export function watchedByIds(item: Pick<WatchlistItemRecord, 'watchedBy'>): string[] {
    return (item.watchedBy ?? []).filter((id): id is string => id !== null);
}

export function isWatchedBy(item: Pick<WatchlistItemRecord, 'watchedBy'>, userId: string | undefined): boolean {
    return userId !== undefined && watchedByIds(item).includes(userId);
}
