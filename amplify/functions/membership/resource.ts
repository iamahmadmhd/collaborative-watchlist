import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, §4.4, §4.5. Invoked as the handler behind the addMember /
// removeMember / leaveWatchlist custom mutations (data/resource.ts) — one edge,
// data stack -> this function, from that `.handler()` reference.
//
// resourceGroupName: 'data' is required, same shape and same reason as
// claim-username (see that file's resource.ts for the fuller explanation), just
// via a different mechanism: backend.ts's plain CDK `Table.grant(membershipLambda,
// ...)` calls (below) attach a policy to this function's role referencing the
// data stack's table ARNs — the reverse edge, this function -> data stack. Two
// edges between the same two stacks, in opposite directions, is exactly
// CloudformationStackCircularDependencyError, regardless of whether the reverse
// edge comes from Amplify's allow.resource() (claim-username) or a raw CDK
// .grant() call (here). Without this override the function lands in its own
// default nested stack instead of merging into 'data', and the cycle forms
// between that stack and data's.
//
// WATCHLIST_TABLE_NAME / WATCHLIST_MEMBER_TABLE_NAME / USERNAME_TABLE_NAME are
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
    resourceGroupName: 'data',
});
