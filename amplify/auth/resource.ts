import { defineAuth } from '@aws-amplify/backend';
// import { postConfirmation } from "../functions/post-confirmation/resource";

// FR-AUTH-1..7. Email + password, email verification required before member
// privileges (FR-AUTH-2), password reset via email (FR-AUTH-6).
//
// (System Design §4.3). Do not add allow.guest() anywhere; any operation reachable
// without a user-pool token is a defect, asserted by V-10.
export const auth = defineAuth({
    loginWith: {
        email: true,
    },
    // triggers: {
    //   postConfirmation, // creates the UserProfile record — Cognito can't be queried
    //                      // client-side, so display names would otherwise be
    //                      // unavailable (FR-MEM-10, System Design §4.2).
    // },
});
