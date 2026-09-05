import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2, ADR-008, ADR-011. Invoked as the handler behind the
// `claimUsername` custom mutation (data/resource.ts), not a Cognito trigger.
//
// resourceGroupName: 'data' is required here, unlike tmdb-proxy or membership.
// Those two are referenced by data/resource.ts only via `.handler()` (a single
// data -> function edge). claimUsername is ALSO granted access via the
// schema-level `allow.resource(claimUsername)` (data/resource.ts) — that grant
// runs the other direction, function -> data, so without an explicit group this
// function lands in its own default nested stack and the two edges form a
// CloudformationStackCircularDependencyError between it and the data stack.
// postConfirmation hits the same shape (§ its own resource.ts) via 'auth'
// instead, for the equivalent reason (Cognito trigger + allow.resource()).
export const claimUsername = defineFunction({
    name: 'claim-username',
    resourceGroupName: 'data',
});
