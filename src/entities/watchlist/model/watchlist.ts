import type { Schema } from '../../../../amplify/data/resource';

// Types come straight from the Amplify Data schema (amplify/data/resource.ts),
// mirroring entities/movie/model/movie.ts's own reasoning — re-declaring these by
// hand would just be a second, driftable copy.
export type WatchlistRecord = Schema['Watchlist']['type'];
export type WatchlistMemberRecord = Schema['WatchlistMember']['type'];
export type WatchlistRole = NonNullable<WatchlistMemberRecord['role']>;
