import { tmdbSchemas, toGenres, toMovieDetail, toPaginatedMovies } from './tmdb-schemas';
import type { Genre, MovieDetail, PaginatedMovies } from './tmdb-schemas';

// These are v3 endpoints (/discover, /search, /movie, /genre, /trending) — that
// doesn't change based on auth method. v3 accepts either the legacy api_key query
// param or a bearer Read Access Token in the Authorization header (below); the
// "v4" label some TMDB docs use refers to how the token is issued/scoped in their
// dashboard, not to a different set of endpoints for movie data.
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

async function tmdbFetch(
    accessToken: string,
    path: string,
    params: Record<string, string | number | undefined>,
): Promise<unknown> {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }
    // FR-TMDB-1: the credential lives only here, server-side, never in a client-observable
    // request — this fetch runs inside the Lambda, not the browser. Using the bearer Read
    // Access Token in the Authorization header rather than the legacy api_key query param
    // also keeps the credential out of URLs and access logs.
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`TMDB request to ${path} failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

// FR-TMDB-1: accessToken is threaded in explicitly (from the caller's secret() env var)
// rather than read from process.env here, so this module has no hidden dependency
// on Lambda-specific globals and stays testable in isolation.
export function createTmdbClient(accessToken: string) {
    return {
        async fetchGenres(): Promise<Genre[]> {
            const raw = tmdbSchemas.genresResponse.parse(await tmdbFetch(accessToken, '/genre/movie/list', {}));
            return toGenres(raw);
        },

        // FR-DISC-1: trending/popular, no genre filter.
        async fetchTrending(page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/trending/movie/week', { page }),
            );
            return toPaginatedMovies(raw);
        },

        // FR-DISC-3: filtered by one or more genres.
        async fetchDiscover(genreIds: number[], page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/discover/movie', { with_genres: genreIds.join(','), page }),
            );
            return toPaginatedMovies(raw);
        },

        // FR-DISC-2: full-text search by title.
        async fetchSearch(query: string, page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/search/movie', { query, page }),
            );
            return toPaginatedMovies(raw);
        },

        // FR-DISC-4: synopsis, release date, runtime, genres, poster, cast in one call.
        async fetchMovieDetail(tmdbId: string): Promise<MovieDetail> {
            const raw = tmdbSchemas.movieDetail.parse(
                await tmdbFetch(accessToken, `/movie/${encodeURIComponent(tmdbId)}`, { append_to_response: 'credits' }),
            );
            return toMovieDetail(raw);
        },
    };
}
