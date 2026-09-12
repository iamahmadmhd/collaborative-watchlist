import type { AppSyncResolverHandler } from 'aws-lambda';
import { env } from '$amplify/env/tmdb-proxy';
import type { Schema } from '../../data/resource';
import { createTmdbClient } from './tmdb-client';
import { CACHE_TTL_SECONDS, cacheKeys, createCacheStore } from './cache';

// One function for all four TMDB queries: discoverMovies, searchMovies,
// getMovieDetails and getGenres.

const tmdb = createTmdbClient(env.TMDB_ACCESS_TOKEN);
// Injected via addEnvironment in backend.ts once the TmdbCache table exists, so it is
// not in the typed `env` import above.
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

// Dispatch is by argument shape, not event.info.fieldName: event.info arrives undefined
// for Lambda-backed custom operations in this deployment (membership/handler.ts does the
// same). The four argument sets are mutually distinguishable — only getMovieDetails
// carries `tmdbId`, only searchMovies carries `query`, discoverMovies always carries
// `page`, and getGenres carries no arguments at all.
export const handler: AppSyncResolverHandler<Record<string, unknown>, unknown> = async (event) => {
    const args = (event.arguments ?? {}) as Record<string, unknown>;

    if (typeof args.tmdbId === 'string') {
        const tmdbId = args.tmdbId;
        return withCache(cacheKeys.movie(tmdbId), CACHE_TTL_SECONDS.movie, () => tmdb.fetchMovieDetail(tmdbId));
    }

    if (typeof args.query === 'string') {
        const query = args.query;
        const page = toPositivePage(args.page as number | null | undefined);
        return withCache(cacheKeys.search(query, page), CACHE_TTL_SECONDS.search, () => tmdb.fetchSearch(query, page));
    }

    if ('page' in args || 'genreIds' in args) {
        const typedArgs = args as Schema['discoverMovies']['args'];
        const page = toPositivePage(typedArgs.page);
        const genreIds = (typedArgs.genreIds ?? []).filter((id): id is number => id != null);

        if (genreIds.length === 0) {
            // No filter — trending/popular.
            return withCache(cacheKeys.trending(page), CACHE_TTL_SECONDS.trending, () => tmdb.fetchTrending(page));
        }
        // Filtered by one or more genres.
        return withCache(cacheKeys.discover(genreIds, page), CACHE_TTL_SECONDS.discover, () =>
            tmdb.fetchDiscover(genreIds, page),
        );
    }

    return withCache(cacheKeys.genres(), CACHE_TTL_SECONDS.genres, () => tmdb.fetchGenres());
};
