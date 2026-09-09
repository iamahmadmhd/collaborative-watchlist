import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/post-confirmation';
import type { Schema } from '../../data/resource';

// post-confirmation — System Design §4.2, ADR-011 (v1.4)
//
// Cognito post-confirmation trigger, firing once the emailed one-time code is
// verified (FR-AUTH-2). One responsibility: create the UserProfile record
// (FR-MEM-10) — required because Cognito can't be queried from the client, so
// display names would otherwise be unavailable.
//
// As of v1.4 (ADR-011) that's all it does. Username claiming moved out to
// claim-username, called from the post-verification username screen once a
// session exists — there is no longer a signup-time custom:handle/custom:username
// attribute for this trigger to read.
//
// No `owner` field to set here (a bug fix's own false start): UserProfile's
// authorization rule is allow.ownerDefinedIn('id').identityClaim('sub') —
// data/resource.ts — not the default allow.owner(), specifically so ownership
// rides on `id`, a field this create() call already sets correctly to the same
// `sub` every caller (this trigger, claim-username) has always used as the row's
// key. A separate auto-populated `owner` field would need a genuinely
// Cognito-authenticated write to populate itself, which this trigger — running
// over IAM (allow.resource(postConfirmation) below) — structurally can never be;
// a first attempt at setting one explicitly here also turned out to need a
// cross-stack DynamoDB grant this function's stack topology can't safely take
// (see backend.ts's comment on why auth-stack-grouped functions can't be granted
// data-stack tables directly). Keying off `id` instead needs no extra field, no
// extra write, and no extra grant — it was already correct.
const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: PostConfirmationTriggerHandler = async (event) => {
    const userId = event.request.userAttributes.sub;

    const { errors } = await client.models.UserProfile.create({ id: userId });
    if (errors?.length) {
        // Thrown, not swallowed: Cognito's PostConfirmation trigger is blocking, so
        // this fails the confirmation loudly instead of leaving a member signed up
        // with no profile row — exactly the silent-failure mode the false start
        // above (an unchecked `errors` return) hit once already.
        throw new Error(`post-confirmation: failed to create UserProfile: ${JSON.stringify(errors)}`);
    }

    return event;
};
