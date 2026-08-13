import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, ADR-008. Invoked as the handler behind the `claimHandle`
// custom mutation (data/resource.ts), not a Cognito trigger — no
// resourceGroupName override needed; Amplify infers the 'data' group from
// that reference, same as tmdb-proxy and membership will.
export const claimHandle = defineFunction({
    name: 'claim-handle',
});
