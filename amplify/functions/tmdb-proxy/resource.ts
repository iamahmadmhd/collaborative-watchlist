import { defineFunction, secret } from '@aws-amplify/backend';

// One function for all four TMDB queries. TMDB_CACHE_TABLE_NAME is not declared here:
// the TmdbCache table is plain CDK created after this resource exists, so backend.ts
// injects it and handler.ts reads it via process.env — the typed $amplify/env import
// only reflects environment declared at this call site.
export const tmdbProxy = defineFunction({
    name: 'tmdb-proxy',
    timeoutSeconds: 10, // one upstream TMDB call plus a cache round-trip
    environment: {
        // TMDB's bearer Read Access Token, sent in an Authorization header.
        // Set via: npx ampx sandbox secret set TMDB_ACCESS_TOKEN
        TMDB_ACCESS_TOKEN: secret('TMDB_ACCESS_TOKEN'),
    },
});
