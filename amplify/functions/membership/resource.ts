import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, §4.4, §4.5. Invoked as the handler behind the addMember /
// removeMember / leaveWatchlist custom mutations (data/resource.ts) — no
// resourceGroupName override needed; Amplify infers the 'data' group from that
// reference, same as claim-handle and tmdb-proxy.
//
// WATCHLIST_TABLE_NAME / WATCHLIST_MEMBER_TABLE_NAME / HANDLE_TABLE_NAME are
// deliberately NOT declared here. This function writes to Watchlist and
// WatchlistMember via DynamoDB TransactWriteItems, not through the generated
// GraphQL resolvers — AppSync/Amplify Data has no atomic multi-model write
// primitive, which is the entire reason FR-MEM-8 needs a hand-written function
// in the first place. That means table names and their IAM grants can only be
// wired up in amplify/backend.ts, after backend.data's tables exist — the same
// timing constraint TMDB_CACHE_TABLE_NAME has in tmdb-proxy/resource.ts. They're
// read via process.env in handler.ts rather than the typed $amplify/env import.
export const membership = defineFunction({
    name: 'membership',
});
