import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, §4.4, ADR-001. Invoked as the handler behind the
// `addWatchlistItem` custom mutation (data/resource.ts).
//
// Why item creation needs a function at all: WatchlistItem carries its own
// denormalised editors/viewers copy (ADR-001) so AppSync can authorize per-item
// reads and subscriptions without a parent lookup. Under the generated `create`
// resolver those arrays — and `watchlistId` itself — are client-supplied, and
// `allow.ownersDefinedIn('editors')` can only check that the CALLER appears in
// the array the caller just wrote. Nothing tied the new item to its parent, so
// any authenticated member could create an item against any watchlistId with
// arbitrary editors/viewers. This function is the missing parent check: it reads
// the Watchlist server-side, verifies the caller is its Owner or an Editor, and
// stamps the permission arrays (and addedBy/addedAt) from that authoritative
// read rather than from the request.
//
// Unlike membership/delete-account, the actual write goes back through AppSync
// (the generated createWatchlistItem mutation, under the schema-level
// allow.resource(watchlistItem) IAM grant in data/resource.ts) rather than
// straight to DynamoDB. That is load-bearing: AppSync only publishes
// subscription events for mutations that pass through it, and /lists/:id's
// real-time integration (§2.4, FR-SYNC-1..5) depends on onCreateWatchlistItem
// firing for every added film. A raw DynamoDB Put here would be invisible to
// every connected collaborator.
//
// resourceGroupName: 'data' — required, same shape and same reason as
// claim-username (see that file's resource.ts): this function is referenced by
// data/resource.ts via `.handler()` (data -> function) AND granted access via
// the schema-level `allow.resource(watchlistItem)` plus backend.ts's
// `watchlistTable.grant(...)` (function -> data). Two edges in opposite
// directions between two nested stacks is CloudformationStackCircularDependencyError.
//
// WATCHLIST_TABLE_NAME is deliberately NOT declared here — the parent read is a
// direct DynamoDB GetItem, so the table name and its IAM grant can only be wired
// in amplify/backend.ts once backend.data's tables exist, and it is read via
// process.env rather than the typed $amplify/env import (same constraint
// membership/resource.ts documents).
//
// The parent read deliberately does NOT go through AppSync: Watchlist's
// ownerId/editors/viewers carry field-level authorization rules that name only
// user-pool principals (data/resource.ts), and `allow.resource()` has no
// field-level form in the installed @aws-amplify/data-schema — an IAM-mode read
// could come back with those three fields nulled, which is exactly the data this
// function authorizes against. A raw GetItem sees the row as written.
export const watchlistItem = defineFunction({
    name: 'watchlist-item',
    resourceGroupName: 'data',
    // One DynamoDB point read plus one AppSync mutation round-trip; the 3s
    // default leaves no headroom for a cold AppSync connection.
    timeoutSeconds: 10,
});
