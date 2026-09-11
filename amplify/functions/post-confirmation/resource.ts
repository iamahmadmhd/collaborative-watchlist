import { defineFunction } from '@aws-amplify/backend';

// Grouped into the auth stack because it is wired as a Cognito trigger in
// ../../auth/resource.ts. See System Design §4.6.
export const postConfirmation = defineFunction({
    name: 'post-confirmation',
    resourceGroupName: 'auth',
});
