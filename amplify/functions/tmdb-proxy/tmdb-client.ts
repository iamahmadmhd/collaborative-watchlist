import { tmdbSchemas, toGenres, toMovieDetail, toPaginatedMovies } from './tmdb-schemas';
import type { Genre, MovieDetail, PaginatedMovies } from './tmdb-schemas';

// v3 endpoints, which accept either the legacy api_key query param or a bearer Read
// Access Token in the Authorization header. The "v4" label in some TMDB docs refers to
// how the token is issued, not to a different set of movie-data endpoints.
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
    // The bearer token goes in a header rather than the legacy api_key query param, which
    // keeps the credential out of URLs and access logs.
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

// accessToken is threaded in rather than read from process.env, so this module has no
// hidden dependency on Lambda globals and stays testable in isolation.
export function createTmdbClient(accessToken: string) {
    return {
        async fetchGenres(): Promise<Genre[]> {
            const raw = tmdbSchemas.genresResponse.parse(await tmdbFetch(accessToken, '/genre/movie/list', {}));
            return toGenres(raw);
        },

        // Trending/popular, no genre filter.
        async fetchTrending(page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/trending/movie/week', { page }),
            );
            return toPaginatedMovies(raw);
        },

        // Filtered by one or more genres.
        async fetchDiscover(genreIds: number[], page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/discover/movie', { with_genres: genreIds.join(','), page }),
            );
            return toPaginatedMovies(raw);
        },

        // Full-text search by title.
        async fetchSearch(query: string, page: number): Promise<PaginatedMovies> {
            const raw = tmdbSchemas.paginatedMovies.parse(
                await tmdbFetch(accessToken, '/search/movie', { query, page }),
            );
            return toPaginatedMovies(raw);
        },

        // Synopsis, release date, runtime, genres, poster and cast in one call.
        async fetchMovieDetail(tmdbId: string): Promise<MovieDetail> {
            const raw = tmdbSchemas.movieDetail.parse(
                await tmdbFetch(accessToken, `/movie/${encodeURIComponent(tmdbId)}`, { append_to_response: 'credits' }),
            );
            return toMovieDetail(raw);
        },
    };
}
