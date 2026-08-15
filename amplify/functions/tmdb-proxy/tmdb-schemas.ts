import { z } from 'zod';

// FR-TMDB-3: TMDB's field naming (snake_case, numeric ids, nulls) must never reach
// the client. Each raw schema below is parsed from the untrusted TMDB response —
// unknown/extra TMDB fields are stripped by Zod's default object behaviour — then
// mapped through a `to*` function into the camelCase, tmdbId-as-string shape that
// matches the GraphQL custom types in data/resource.ts.

const rawGenre = z.object({
    id: z.number(),
    name: z.string(),
});

const rawGenresResponse = z.object({
    genres: z.array(rawGenre),
});

const rawMovieSummary = z.object({
    id: z.number(),
    title: z.string(),
    poster_path: z.string().nullable(),
    release_date: z.string().optional().default(''),
});

const rawPaginatedMovies = z.object({
    page: z.number(),
    results: z.array(rawMovieSummary),
    total_pages: z.number(),
    total_results: z.number(),
});

const rawCastMember = z.object({
    id: z.number(),
    name: z.string(),
    character: z.string().optional().default(''),
    profile_path: z.string().nullable(),
});

const rawMovieDetail = z.object({
    id: z.number(),
    title: z.string(),
    overview: z.string().nullable(),
    release_date: z.string().optional().default(''),
    runtime: z.number().nullable(),
    poster_path: z.string().nullable(),
    genres: z.array(rawGenre),
    credits: z.object({ cast: z.array(rawCastMember) }),
});

export const tmdbSchemas = {
    genresResponse: rawGenresResponse,
    paginatedMovies: rawPaginatedMovies,
    movieDetail: rawMovieDetail,
};

export type Genre = { id: number; name: string };
export type MovieSummary = { tmdbId: string; title: string; posterPath: string | null; releaseYear: number | null };
export type CastMember = { tmdbId: string; name: string; character: string | null; profilePath: string | null };
export type MovieDetail = {
    tmdbId: string;
    title: string;
    overview: string | null;
    releaseDate: string | null;
    runtimeMinutes: number | null;
    posterPath: string | null;
    genres: Genre[];
    cast: CastMember[];
};
export type PaginatedMovies = { results: MovieSummary[]; page: number; totalPages: number; totalResults: number };

function releaseYearOf(releaseDate: string): number | null {
    const year = Number(releaseDate.slice(0, 4));
    return Number.isFinite(year) && year > 0 ? year : null;
}

function toGenre(raw: z.infer<typeof rawGenre>): Genre {
    return { id: raw.id, name: raw.name };
}

function toMovieSummary(raw: z.infer<typeof rawMovieSummary>): MovieSummary {
    return {
        tmdbId: String(raw.id),
        title: raw.title,
        posterPath: raw.poster_path,
        releaseYear: releaseYearOf(raw.release_date),
    };
}

export function toPaginatedMovies(raw: z.infer<typeof rawPaginatedMovies>): PaginatedMovies {
    return {
        results: raw.results.map(toMovieSummary),
        page: raw.page,
        totalPages: raw.total_pages,
        totalResults: raw.total_results,
    };
}

export function toGenres(raw: z.infer<typeof rawGenresResponse>): Genre[] {
    return raw.genres.map(toGenre);
}

// TMDB returns cast in billing order already; capped to keep the cache payload and
// response size reasonable — FR-DISC-4 asks for "cast", not the full crew list.
const MAX_CAST_MEMBERS = 10;

export function toMovieDetail(raw: z.infer<typeof rawMovieDetail>): MovieDetail {
    return {
        tmdbId: String(raw.id),
        title: raw.title,
        overview: raw.overview,
        releaseDate: raw.release_date || null,
        runtimeMinutes: raw.runtime,
        posterPath: raw.poster_path,
        genres: raw.genres.map(toGenre),
        cast: raw.credits.cast.slice(0, MAX_CAST_MEMBERS).map((c) => ({
            tmdbId: String(c.id),
            name: c.name,
            character: c.character || null,
            profilePath: c.profile_path,
        })),
    };
}
