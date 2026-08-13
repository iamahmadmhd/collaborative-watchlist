import { defineFunction } from '@aws-amplify/backend';

// System Design §4.2. resourceGroupName: 'auth' groups this Cognito trigger with
// the auth stack rather than the default function group — required because it's
// wired via triggers in ../../auth/resource.ts.
export const postConfirmation = defineFunction({
    name: 'post-confirmation',
    resourceGroupName: 'auth',
});
