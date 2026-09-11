import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';

// Passwordless: email OTP only. otpLogin adds email-OTP alongside Cognito's password
// capability — Amplify Gen 2 has no switch to remove password at the platform level —
// but the application never collects, displays, or calls it.
//
// Do not add allow.guest() anywhere: any operation reachable without a user-pool token
// is a defect.
export const auth = defineAuth({
    loginWith: {
        email: {
            otpLogin: true,
        },
    },
    triggers: {
        // Creates the UserProfile record: Cognito cannot be queried client-side, so
        // display names would otherwise be unavailable.
        postConfirmation,
    },
});
