import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/post-confirmation';
import type { Schema } from '../../data/resource';

// Cognito post-confirmation trigger, firing once the emailed code is verified. Its
// one job is creating the UserProfile record: Cognito cannot be queried from the
// client, so display names would otherwise be unavailable. The username is claimed
// separately, afterwards, by claim-username.
//
// There is no `owner` field to set: UserProfile's ownership rides on `id`, which
// this create() already sets to the caller's sub. A separate auto-populated owner
// field could never be filled by this trigger, which runs over IAM.
const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: PostConfirmationTriggerHandler = async (event) => {
    const userId = event.request.userAttributes.sub;

    const { errors } = await client.models.UserProfile.create({ id: userId });
    if (errors?.length) {
        // Cognito documents that this trigger can fire more than once for a single
        // sign-up, so a conflict on `id` means the earlier invocation already did the
        // job. Throwing here would leave the account UNCONFIRMED and every retry
        // would hit the same conflict, locking the member out permanently. Any other
        // error still throws.
        if (isAlreadyCreated(errors)) {
            return event;
        }
        throw new Error(`post-confirmation: failed to create UserProfile: ${JSON.stringify(errors)}`);
    }

    return event;
};

function isAlreadyCreated(errors: ReadonlyArray<{ errorType?: string; message?: string }>): boolean {
    return errors.some(
        (e) =>
            e.errorType?.includes('ConditionalCheckFailedException') ||
            e.message?.includes('ConditionalCheckFailedException'),
    );
}
