// tmdb-proxy — System Design §4.2, §6, ADR-007
//
// Handles all four TMDB queries (discoverMovies, searchMovies, getMovieDetails,
// getGenres) in ONE function, routing on the GraphQL field name — not four
// separate functions. Rationale: four cold-start surfaces on the discovery
// path would work against NFR-PERF-1's 4s cold budget; one warm function
// serving all discovery traffic is the point.
//
// v1.1: this function requires an authenticated caller (ADR-009). Every invocation
// carries a user-pool identity — useful for the per-principal rate limiting that
// NFR-SEC-3 now specifies.
//
// Responsibilities, in order:
//   1. Resolve the field name being invoked (event.info.fieldName / event.arguments).
//   2. Build a normalised cache key (lowercase + trim search terms, sort filter
//      params — System Design §5.5) and check the TmdbCache DynamoDB table.
//   3. On a cache hit where `expiresAt` (epoch seconds) has NOT passed: return
//      the cached payload. DynamoDB TTL deletion can lag up to 48h — do NOT
//      treat row *existence* as a hit; compare expiresAt explicitly.
//   4. On a miss: fetch the TMDB credential via the Amplify `secret()` helper
//      (SSM Parameter Store — FR-TMDB-1, NFR-SEC-5), call TMDB over HTTPS,
//      validate/parse the response through Zod (FR-TMDB-3 — TMDB's field
//      naming must never reach the client), write the cache entry with the
//      appropriate TTL (table in §5.5: genres 7d, trending 1h, discover 1h,
//      movie 24h, search 15m), and return the normalised payload.
//   5. Image paths (FR-TMDB-4): return relative paths as given by TMDB. Do NOT
//      construct full image URLs server-side — the client picks w185 vs w500.
//
// TODO: implement. See resource.ts (create it) for the Lambda + secret() wiring.
