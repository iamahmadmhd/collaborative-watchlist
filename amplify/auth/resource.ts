import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';

// FR-AUTH-1..7, ADR-010 (v1.2). Passwordless: email OTP only, no password anywhere.
// otpLogin adds email-OTP as a login method alongside Cognito's password capability
// — Amplify Gen2 has no switch to remove password at the platform level — but the
// application never collects, displays, or calls it, which is what "no password"
// means here (see ADR-010's rationale).
//
// custom:handle carries the handle chosen at sign-up through to postConfirmation,
// which claims it atomically once the emailed code is verified (System Design
// §4.2) — there is no authenticated session yet at signUp() time for a
// client-authenticated claim call to be possible. Not required at the Cognito
// level (custom attributes can't be) — postConfirmation treats a missing/invalid
// value as "no handle claimed," recoverable later via claim-handle from Settings.
//
// (System Design §4.3). Do not add allow.guest() anywhere; any operation reachable
// without a user-pool token is a defect, asserted by V-10.
export const auth = defineAuth({
    loginWith: {
        email: {
            otpLogin: true,
        },
    },
    userAttributes: {
        'custom:handle': {
            dataType: 'String',
            mutable: true,
            minLen: 3,
            maxLen: 20,
        },
    },
    triggers: {
        postConfirmation, // creates the UserProfile record and claims custom:handle —
        // Cognito can't be queried client-side, so display names would otherwise be
        // unavailable (FR-MEM-10, System Design §4.2).
    },
});
