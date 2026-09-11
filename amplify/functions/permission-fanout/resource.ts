import { defineFunction } from '@aws-amplify/backend';

// DynamoDB stream consumer for the Watchlist and WatchlistItem tables. Unlike the
// other functions it is not schema-referenced at all: the stream ARNs, the
// dead-letter queue and its table-name env vars are wired in backend.ts, since none
// of them exist until backend.data's tables are synthesized.
//
// resourceGroupName is required here even though this function has no data-stack edge
// of its own: without it, it shares the catch-all "function" stack with tmdb-proxy,
// whose schema reference would combine with this function's table grants to form a
// cycle. See System Design §4.6.
export const permissionFanout = defineFunction({
    name: 'permission-fanout',
    resourceGroupName: 'data',
    // A Query plus chunked BatchWriteItem over a few hundred items needs more headroom
    // than the 3s default.
    timeoutSeconds: 30,
});
