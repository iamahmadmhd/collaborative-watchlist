// membership — System Design §4.2, §4.5
//
// The transactional function: add / remove / leave a collaborator. Adding a
// collaborator writes a WatchlistMember record AND pushes the user into the
// parent Watchlist's editors/viewers array — two tables, and FR-MEM-8
// forbids an observable partial result (one table updated, the other not).
//
// Use TransactWriteItems, not two sequential PutItem calls. Generated Amplify
// resolvers write one item each and cannot satisfy this atomicity requirement
// — that's why this is a hand-written function, not a generated mutation.
//
// Remove and leave are the same transaction inverted, with different role
// checks (an Owner can remove anyone; a member can only remove themselves via
// "leave"). This function is also the mechanism by which FR-MEM-9 / NFR-SEC-2
// hold: it is the ONLY writer of ownerId/editors/viewers (see data/resource.ts
// TODO on Watchlist's field-level auth — this function is what allow.resource()
// should point at).
//
// A successful membership change here is what should trigger the DynamoDB
// stream that permission-fanout consumes (§4.5) — this function doesn't call
// fanout directly, the stream does that asynchronously.
//
// TODO: implement. See resource.ts (create it) for the Lambda + IAM wiring
// (System Design §4.3 — this function needs allow.resource() write access
// into Data, via IAM, not user-pool auth).
