import { defineFunction } from '@aws-amplify/backend';

// Handler behind the `deleteAccount` mutation. Its writes go straight to DynamoDB —
// Watchlist's permission fields have no GraphQL write path for anyone, and there is no
// cross-model transactional mutation to route through. Table names are wired in
// backend.ts and read via process.env, as with membership.
// resourceGroupName: see System Design §4.6.
export const deleteAccount = defineFunction({
    name: 'delete-account',
    resourceGroupName: 'data',
});
