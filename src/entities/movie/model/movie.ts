import type { Schema } from '../../../../amplify/data/resource';
import { imageCdnDomain } from '../../../shared/config/image-cdn';

// Types come straight from the GraphQL custom types; re-declaring them by hand would
// be a second, driftable copy of the schema.
export type MovieSummary = Schema['MovieSummary']['type'];
export type MovieDetail = Schema['MovieDetail']['type'];
export type PaginatedMovies = Schema['PaginatedMovies']['type'];
export type Genre = Schema['Genre']['type'];
export type CastMember = Schema['CastMember']['type'];

// The client picks the rendering size: w185 for grid/row cards and cast photos, w500
// for the movie-detail poster. The URL is built against our own image CDN rather than
// image.tmdb.org — see System Design ADR-013.
export function posterUrl(posterPath: string | null | undefined, size: 'w185' | 'w500'): string | null {
    return posterPath && imageCdnDomain ? `https://${imageCdnDomain}/${size}${posterPath}` : null;
}

// SavedMovie stores a releaseYear snapshot rather than the full date MovieDetail
// carries, so movie-detail can build a MovieSummary without a second save path.
export function releaseYearOf(releaseDate: string | null | undefined): number | null {
    const year = Number((releaseDate ?? '').slice(0, 4));
    return Number.isFinite(year) && year > 0 ? year : null;
}
