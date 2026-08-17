import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, §4.5, §5.4. DynamoDB stream consumer for both the Watchlist
// and WatchlistItem tables (see handler.ts for why one function owns both streams).
// Not invoked via a.handler.function() from data/resource.ts — this function is
// wired directly to two DynamoDB Streams as Lambda event sources in backend.ts,
// where the stream ARNs, the dead-letter queue, and the WATCHLIST_TABLE_NAME /
// WATCHLIST_ITEM_TABLE_NAME env vars are all set up (mirrors the timing constraint
// tmdb-proxy's TMDB_CACHE_TABLE_NAME and membership's table-name env vars have —
// none of this exists until backend.data's tables are synthesized).
export const permissionFanout = defineFunction({
    name: 'permission-fanout',
    // NFR-SEC-4's 30s propagation window is a target for the whole operation
    // (stream delivery + this function's work), not a hard Lambda ceiling — but a
    // Query plus chunked BatchWriteItem over up to a few hundred items needs more
    // headroom than the 3s default.
    timeoutSeconds: 30,
});
