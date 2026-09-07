import type { Schema } from '../../../../amplify/data/resource';

// Types come straight from the GraphQL custom types in amplify/data/resource.ts
// (FR-TMDB-3 — TMDB's own shape never reaches the client; tmdb-proxy's Zod
// mapping already normalised it before this type is ever seen). Re-declaring
// these fields by hand would just be a second, driftable copy of the schema.
export type MovieSummary = Schema['MovieSummary']['type'];
export type MovieDetail = Schema['MovieDetail']['type'];
export type PaginatedMovies = Schema['PaginatedMovies']['type'];
export type Genre = Schema['Genre']['type'];
export type CastMember = Schema['CastMember']['type'];

// FR-TMDB-4: the client picks the rendering size. w185 for grid/row cards and
// cast photos, w500 for movie-detail's poster. TMDB serves the image CDN
// itself, not the API host — an https URL is the whole "resolution."
export function posterUrl(posterPath: string | null | undefined, size: 'w185' | 'w500'): string | null {
    return posterPath ? `https://image.tmdb.org/t/p/${size}${posterPath}` : null;
}

// SavedMovie (amplify/data/resource.ts) stores a releaseYear snapshot, not the
// full date MovieDetail carries — this derives one from the other so
// movie-detail-page can build a MovieSummary for useToggleSave without a
// second, duplicate save path. Mirrors tmdb-proxy/tmdb-schemas.ts's
// releaseYearOf exactly (that one runs server-side, over TMDB's raw
// release_date; this one runs client-side, over the already-normalised
// MovieDetail.releaseDate — same shape, same rule).
export function releaseYearOf(releaseDate: string | null | undefined): number | null {
    const year = Number((releaseDate ?? '').slice(0, 4));
    return Number.isFinite(year) && year > 0 ? year : null;
}
