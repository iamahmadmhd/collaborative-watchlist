import { defineFunction } from '@aws-amplify/backend';

// Handler behind the `toggleWatched` custom mutation: the only writer of
// WatchlistItem.watchedBy, which denies `update` to every GraphQL caller. See System
// Design §4.4 and ADR-014.
//
// WATCHLIST_ITEM_TABLE_NAME is wired in backend.ts, where backend.data's tables exist,
// and read via process.env rather than the typed $amplify/env import.
// resourceGroupName: see System Design §4.6.
export const toggleWatched = defineFunction({
    name: 'toggle-watched',
    resourceGroupName: 'data',
    // A point read plus one conditional update, with a bounded retry on the unmark
    // path; the 3s default leaves no room for the retry.
    timeoutSeconds: 10,
});
