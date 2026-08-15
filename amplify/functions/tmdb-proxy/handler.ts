import type { AppSyncResolverHandler } from 'aws-lambda';
import { env } from '$amplify/env/tmdb-proxy';
import type { Schema } from '../../data/resource';
import { createTmdbClient } from './tmdb-client';
import { CACHE_TTL_SECONDS, cacheKeys, createCacheStore } from './cache';

// tmdb-proxy — System Design §4.2, §6, ADR-007
//
// One function for all four TMDB queries (discoverMovies, searchMovies,
// getMovieDetails, getGenres), routed on the GraphQL field name. Separate
// functions per query would mean four cold-start surfaces on the discovery path;
// one warm function serving all discovery traffic serves NFR-PERF-1's 4s cold
// budget better. Every invocation carries a user-pool identity (ADR-009) — not
// used for per-request logic here, but it's what makes NFR-SEC-3's per-principal
// WAF throttle (System Design §6, applied at the AppSync API, not in this
// function) possible in the first place.

const tmdb = createTmdbClient(env.TMDB_ACCESS_TOKEN);
// TMDB_CACHE_TABLE_NAME is injected via CDK addEnvironment in backend.ts once the
// plain-CDK TmdbCache table exists (§5.5) — it isn't declared in this function's
// defineFunction environment, so it isn't in the typed `env` import above.
const cache = createCacheStore(process.env.TMDB_CACHE_TABLE_NAME!);

async function withCache<T>(cacheKey: string, ttlSeconds: number, fetchFresh: () => Promise<T>): Promise<T> {
    const cached = await cache.get<T>(cacheKey);
    if (cached) {
        return cached;
    }
    const fresh = await fetchFresh();
    await cache.put(cacheKey, fresh, ttlSeconds);
    return fresh;
}

function toPositivePage(page: number | null | undefined): number {
    return page && page > 0 ? Math.floor(page) : 1;
}

export const handler: AppSyncResolverHandler<Record<string, unknown>, unknown> = async (event) => {
    switch (event.info.fieldName) {
        case 'getGenres':
            return withCache(cacheKeys.genres(), CACHE_TTL_SECONDS.genres, () => tmdb.fetchGenres());

        case 'discoverMovies': {
            const args = event.arguments as Schema['discoverMovies']['args'];
            const page = toPositivePage(args.page);
            const genreIds = (args.genreIds ?? []).filter((id): id is number => id != null);

            if (genreIds.length === 0) {
                // FR-DISC-1: no filter — trending/popular.
                return withCache(cacheKeys.trending(page), CACHE_TTL_SECONDS.trending, () => tmdb.fetchTrending(page));
            }
            // FR-DISC-3: filtered by one or more genres.
            return withCache(cacheKeys.discover(genreIds, page), CACHE_TTL_SECONDS.discover, () =>
                tmdb.fetchDiscover(genreIds, page),
            );
        }

        case 'searchMovies': {
            const args = event.arguments as Schema['searchMovies']['args'];
            const page = toPositivePage(args.page);
            return withCache(cacheKeys.search(args.query, page), CACHE_TTL_SECONDS.search, () =>
                tmdb.fetchSearch(args.query, page),
            );
        }

        case 'getMovieDetails': {
            const args = event.arguments as Schema['getMovieDetails']['args'];
            return withCache(cacheKeys.movie(args.tmdbId), CACHE_TTL_SECONDS.movie, () =>
                tmdb.fetchMovieDetail(args.tmdbId),
            );
        }

        default:
            throw new Error(`tmdb-proxy: unhandled field "${event.info.fieldName}"`);
    }
};
