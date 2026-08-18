import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/post-confirmation';
import type { Schema } from '../../data/resource';

// post-confirmation — System Design §4.2, ADR-010 (v1.2)
//
// Cognito post-confirmation trigger, firing once the emailed one-time code is
// verified (FR-AUTH-2). Two responsibilities:
//
// 1. Create the UserProfile record (FR-MEM-10) — required because Cognito can't
//    be queried from the client, so display names would otherwise be unavailable.
// 2. Atomically claim the handle submitted at sign-up via the custom:handle
//    attribute (FR-AUTH-3/4, ADR-008, ADR-010). This is the only point in the
//    flow with both the member's chosen handle AND backend write access before
//    any authenticated session exists — claim-handle (still present, System
//    Design §4.2) can't run this early, since it requires an authenticated
//    caller and there is no session yet at signUp() time.
//
// The conditional write is the same idiom as claim-handle's own
// attribute_not_exists(handle) check (ADR-008) — Handle.create()'s generated
// resolver gets that condition for free from the model's identifier. A
// conditional-check failure here (someone else claimed the same handle between
// the sign-up form's live-availability check and this trigger running) does NOT
// fail the sign-up: verification already succeeded, and there is no user-facing
// way to reject an account at this point. UserProfile is created without a
// handle instead, and the member claims one afterward via claim-handle from
// Settings — the one documented exception to "handle changes are not supported"
// (System Design §9 #6): claiming a first handle stays possible, changing an
// already-claimed one does not.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

// Not shared with the frontend form: amplify/** and src/** are separate
// compilation contexts, so this is a deliberate, separately-maintained
// duplicate of the same pattern check used in claim-handle/handler.ts.
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export const handler: PostConfirmationTriggerHandler = async (event) => {
    const userId = event.request.userAttributes.sub;
    const requestedHandle = event.request.userAttributes['custom:handle']?.trim().toLowerCase();

    let claimedHandle: string | undefined;
    if (requestedHandle && HANDLE_PATTERN.test(requestedHandle)) {
        const { errors } = await client.models.Handle.create({ handle: requestedHandle, userId });
        if (!errors) {
            claimedHandle = requestedHandle;
        } else {
            // Expected outcome on a lost race, not an operational failure — logged
            // for visibility only. Does not throw: failing account creation over a
            // handle race would be a worse outcome than an account with no handle yet.
            console.warn(`post-confirmation: could not claim handle "${requestedHandle}" for ${userId}`, errors);
        }
    }

    await client.models.UserProfile.create({
        id: userId,
        ...(claimedHandle ? { handle: claimedHandle } : {}),
    });

    return event;
};
