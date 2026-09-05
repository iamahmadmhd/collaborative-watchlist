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

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: PostConfirmationTriggerHandler = async (event) => {
    const userId = event.request.userAttributes.sub;

    await client.models.UserProfile.create({ id: userId });

    return event;
};
