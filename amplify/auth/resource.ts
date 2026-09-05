import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';

// FR-AUTH-1..7, ADR-010 (v1.2). Passwordless: email OTP only, no password anywhere.
// otpLogin adds email-OTP as a login method alongside Cognito's password capability
// — Amplify Gen2 has no switch to remove password at the platform level — but the
// application never collects, displays, or calls it, which is what "no password"
// means here (see ADR-010's rationale).
//
// No custom:handle/custom:username attribute (ADR-011, v1.4 — removed, not renamed).
// The username step now runs after postConfirmation, authenticated, via
// claim-username (System Design §4.2) — there is no longer anything for a
// signup-time Cognito attribute to carry.
//
// (System Design §4.3). Do not add allow.guest() anywhere; any operation reachable
// without a user-pool token is a defect, asserted by V-10.
export const auth = defineAuth({
    loginWith: {
        email: {
            otpLogin: true,
        },
    },
    triggers: {
        postConfirmation, // creates the UserProfile record —
        // Cognito can't be queried client-side, so display names would otherwise be
        // unavailable (FR-MEM-10, System Design §4.2).
    },
});
