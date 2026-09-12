import { defineFunction } from '@aws-amplify/backend';

// Handler behind the `addWatchlistItem` custom mutation. It exists because the
// generated create resolver cannot authorize a WatchlistItem against its parent: it
// only ever sees the editors/viewers arrays the caller sent. This function reads the
// Watchlist server-side, checks the caller is Owner or Editor, and stamps the
// permission arrays from that read.
//
// The parent read is a raw GetItem rather than an AppSync query, because Watchlist's
// permission fields carry field-level rules naming only user-pool principals — an
// IAM-mode read could return exactly those three fields nulled. The write, by
// contrast, goes back through AppSync: only mutations passing through it publish the
// onCreateWatchlistItem subscription event /lists/:id depends on.
//
// WATCHLIST_TABLE_NAME is wired in backend.ts, where backend.data's tables exist, and
// read via process.env rather than the typed $amplify/env import.
// resourceGroupName: see System Design §4.6.
export const watchlistItem = defineFunction({
    name: 'watchlist-item',
    resourceGroupName: 'data',
    // One DynamoDB point read plus an AppSync round-trip; the 3s default is too tight.
    timeoutSeconds: 10,
});
