import { defineFunction, secret } from '@aws-amplify/backend';

// System Design §4.2, §6, ADR-007. One function for all four TMDB queries — see
// handler.ts for the routing rationale.
//
// TMDB_CACHE_TABLE_NAME is deliberately NOT declared here: the TmdbCache table is
// plain CDK (amplify/backend.ts), created after this function resource exists, and
// wired in via backend.tmdbProxy.resources.lambda.addEnvironment(...) once the table
// is available. It is read via process.env in handler.ts rather than the typed
// $amplify/env import, which only reflects environment declared at this call site.
export const tmdbProxy = defineFunction({
    name: 'tmdb-proxy',
    timeoutSeconds: 10, // one upstream TMDB call plus a cache round-trip; default 3s is tight
    environment: {
        // TMDB's bearer Read Access Token, sent in an Authorization header — see
        // tmdb-client.ts (System Design §6, FR-TMDB-1, NFR-SEC-5).
        // Set via: npx ampx sandbox secret set TMDB_ACCESS_TOKEN
        TMDB_ACCESS_TOKEN: secret('TMDB_ACCESS_TOKEN'),
    },
});
