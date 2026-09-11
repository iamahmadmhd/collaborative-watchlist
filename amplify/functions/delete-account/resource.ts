import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2/§4.4/§4.5-shaped (NFR-COMP-2), same rationale as membership's own
// resource.ts: this function's real writes (Watchlist.editors/viewers, cascade-deleting
// an owned watchlist's members/items) go straight to DynamoDB via TransactWriteItems/
// BatchWriteItem, not through AppSync's generated resolvers — Watchlist's ownerId/editors/
// viewers fields have NO update grant to anyone via GraphQL at all (data/resource.ts,
// FR-MEM-9/NFR-SEC-2), and there is no cross-model transactional mutation to grant access
// to in the first place. resourceGroupName: 'data' merges this function into the data
// stack instead of its own default nested stack, avoiding the same
// CloudformationStackCircularDependencyError membership/resource.ts documents: backend.ts's
// plain CDK `Table.grant(deleteAccountLambda, ...)` calls create the data-stack -> this
// function edge; without this override, this function's own default stack would also gain
// an edge back to data (via its `.handler()` reference in data/resource.ts), forming the cycle.
//
// Table names are deliberately not declared here for the same reason as membership's —
// they're only wired up in amplify/backend.ts, after backend.data's tables exist, and read
// via process.env rather than the typed $amplify/env import.
export const deleteAccount = defineFunction({
    name: 'delete-account',
    resourceGroupName: 'data',
});
