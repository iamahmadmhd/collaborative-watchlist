// permission-fanout — System Design §4.5, §5.4, ADR-001
//
// DynamoDB stream consumer on the Watchlist table (wired via CDK escape hatch
// in amplify/backend.ts — Amplify Gen 2 doesn't expose stream config
// declaratively). Two responsibilities, both driven by stream events:
//
// 1. Permission fan-out (§4.5): compare old/new Watchlist images. If
//    editors/viewers changed, query all WatchlistItems for that watchlistId
//    and rewrite their editors/viewers arrays via BatchWriteItem in chunks
//    of 25. This keeps ADR-001's denormalised arrays in sync. Must be:
//      - Idempotent (overwrite, not delta — safe to retry)
//      - Bounded: max 20 members (FR-MEM-7) + lists of a few hundred items
//        keeps this realistically inside the 30s window (NFR-SEC-4)
//      - Backed by a dead-letter queue — a silent failure here means stale
//        permissions with nothing surfacing. Do not skip the DLQ.
//
// 2. Item count maintenance (§5.4): also consume the WatchlistItem stream
//    and perform an atomic ADD on the parent Watchlist.itemCount (FR-LIST-6).
//    This lives in the same function because it already owns cross-table
//    consistency and already has a DLQ — one consistency story, not two.
//
// The hot path (adding a single movie) is unaffected — fan-out only fires on
// membership change, which is rare; item creation just copies the arrays
// down from the parent at creation time (no fan-out trigger).
//
// TODO: implement. See resource.ts (create it) for the DLQ + stream event
// source wiring, and amplify/backend.ts for the CDK escape hatch.
