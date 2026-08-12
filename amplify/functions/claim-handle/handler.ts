// claim-handle — System Design §4.2, ADR-008, ties to FR-AUTH-3/4 and V-1
//
// Conditional write against the Handle table, keyed on the handle string,
// conditioned on `attribute_not_exists(handle)`. This conditional write IS
// the mechanism behind FR-AUTH-4 ("no window in which two members hold the
// same handle") and verification target V-1 (concurrent claims: exactly one
// succeeds). The async availability check the client does first is UX only —
// two members can pass it simultaneously; THIS function's conditional write
// is the actual atomicity guarantee. The client must handle a rejection here
// gracefully even after the UX check passed (System Design §2.5).
//
// On success, also update UserProfile.handle for the calling user (two
// writes — consider whether this needs the same transactional treatment as
// membership, or whether a failed second write is an acceptable partial
// state here; unlike Watchlist membership, an unclaimed-but-reserved handle
// is not FR-MEM-8's concern, but check before assuming that's fine).
//
// TODO: implement. See resource.ts (create it).
