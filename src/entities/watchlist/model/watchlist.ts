import type { Schema } from '../../../../amplify/data/resource';

// Types come straight from the Amplify Data schema (amplify/data/resource.ts),
// mirroring entities/movie/model/movie.ts's own reasoning — re-declaring these by
// hand would just be a second, driftable copy.
export type WatchlistRecord = Schema['Watchlist']['type'];
export type WatchlistMemberRecord = Schema['WatchlistMember']['type'];
export type WatchlistItemRecord = Schema['WatchlistItem']['type'];
export type WatchlistRole = NonNullable<WatchlistMemberRecord['role']>;

// FR-ITEM-1 / FR-ITEM-7: only these two roles may write to a list's items or
// metadata; VIEWER is read-only. Centralised here so every caller (add-to-list
// gating, per-item remove control, useWatchlistRole consumers) checks the same
// two-role set rather than each re-deriving it.
export function canEditWatchlist(role: WatchlistRole | null | undefined): boolean {
    return role === 'OWNER' || role === 'EDITOR';
}
