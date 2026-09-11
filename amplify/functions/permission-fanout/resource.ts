import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, §4.5, §5.4. DynamoDB stream consumer for both the Watchlist
// and WatchlistItem tables (see handler.ts for why one function owns both streams).
// Not invoked via a.handler.function() from data/resource.ts — this function is
// wired directly to two DynamoDB Streams as Lambda event sources in backend.ts,
// where the stream ARNs, the dead-letter queue, and the WATCHLIST_TABLE_NAME /
// WATCHLIST_ITEM_TABLE_NAME env vars are all set up (mirrors the timing constraint
// tmdb-proxy's TMDB_CACHE_TABLE_NAME and membership's table-name env vars have —
// none of this exists until backend.data's tables are synthesized).
//
// resourceGroupName: 'data' — required, but for a subtler reason than
// claim-username/membership's own (see their resource.ts files). This function
// has no data -> function edge of its own (it's not schema-referenced at all),
// but without an explicit group it lands in Amplify's shared catch-all
// "function" nested stack alongside tmdb-proxy — which DOES have a data ->
// function edge, via its four `.handler(a.handler.function(tmdbProxy))`
// references. backend.ts's `watchlistItemTable.grant(permissionFanoutLambda,
// ...)` / `watchlistTable.grant(permissionFanoutLambda, ...)` calls then supply
// the reverse edge, function -> data, on that SAME shared stack — two edges,
// opposite directions, between "data" and the shared stack, even though neither
// function alone would cause it. Moving this function's home to 'data' (where
// its table access already conceptually belongs) leaves the catch-all stack holding
// only functions with no function -> data edge of their own — tmdb-proxy (one
// one-directional data -> function edge) and, since v1.6, image-proxy (no data edge in
// either direction). No cycle, as long as that stays true: see image-proxy/resource.ts,
// which records the same invariant from the other side.
export const permissionFanout = defineFunction({
    name: 'permission-fanout',
    resourceGroupName: 'data',
    // NFR-SEC-4's 30s propagation window is a target for the whole operation
    // (stream delivery + this function's work), not a hard Lambda ceiling — but a
    // Query plus chunked BatchWriteItem over up to a few hundred items needs more
    // headroom than the 3s default.
    timeoutSeconds: 30,
});
