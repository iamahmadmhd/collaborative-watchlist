// post-confirmation — System Design §4.2
//
// Cognito post-confirmation trigger. Creates the UserProfile record at
// signup. Required because Cognito cannot be queried from the client, so
// display names would otherwise be unavailable (FR-MEM-10).
//
// Note: this fires at email verification (FR-AUTH-2), before the user has
// claimed a handle (FR-AUTH-3, claimed during first-run onboarding) — the
// UserProfile record this creates will have no handle yet. Don't assume
// handle is populated when reading UserProfile; the onboarding flow is a
// separate, later step.
//
// TODO: implement. Wire as a trigger in amplify/auth/resource.ts.
