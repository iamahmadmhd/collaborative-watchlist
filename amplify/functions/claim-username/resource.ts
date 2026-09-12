import { defineFunction } from '@aws-amplify/backend';

// Handler behind the `claimUsername` custom mutation, not a Cognito trigger.
// USER_PROFILE_TABLE_NAME is wired in backend.ts rather than declared here, since this
// function writes UserProfile.username over the raw DynamoDB SDK and the table does
// not exist until backend.data is synthesized.
// resourceGroupName: see System Design §4.6.
export const claimUsername = defineFunction({
    name: 'claim-username',
    resourceGroupName: 'data',
});
