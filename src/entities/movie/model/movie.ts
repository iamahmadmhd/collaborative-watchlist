import type { Schema } from '../../../../amplify/data/resource';

// Types come straight from the GraphQL custom types in amplify/data/resource.ts
// (FR-TMDB-3 — TMDB's own shape never reaches the client; tmdb-proxy's Zod
// mapping already normalised it before this type is ever seen). Re-declaring
// these fields by hand would just be a second, driftable copy of the schema.
export type MovieSummary = Schema['MovieSummary']['type'];
export type MovieDetail = Schema['MovieDetail']['type'];
export type PaginatedMovies = Schema['PaginatedMovies']['type'];
export type Genre = Schema['Genre']['type'];

// FR-TMDB-4: the client picks the rendering size. w185 for grid cards (this
// entity's only current caller); w500 is movie-detail's concern when that page
// exists. TMDB serves the image CDN itself, not the API host — an https URL is
// the whole "resolution."
export function posterUrl(posterPath: string | null | undefined, size: 'w185' | 'w500'): string | null {
    return posterPath ? `https://image.tmdb.org/t/p/${size}${posterPath}` : null;
}
