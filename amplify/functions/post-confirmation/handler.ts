import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/post-confirmation';
import type { Schema } from '../../data/resource';

// post-confirmation — System Design §4.2
//
// Cognito post-confirmation trigger. Creates the UserProfile record at
// signup. Required because Cognito cannot be queried from the client, so
// display names would otherwise be unavailable (FR-MEM-10).
//
// Note: this fires at email verification (FR-AUTH-2), before the user has
// claimed a handle (FR-AUTH-3, claimed during first-run onboarding) — the
// UserProfile record this creates has no handle yet (schema: handle is
// optional for exactly this reason). Don't assume handle is populated when
// reading UserProfile; the onboarding flow sets it via a separate, later
// owner update.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: PostConfirmationTriggerHandler = async (event) => {
    await client.models.UserProfile.create({
        id: event.request.userAttributes.sub,
    });

    return event;
};
