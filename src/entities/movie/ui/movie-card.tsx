import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { posterUrl, type MovieSummary } from '../model/movie';

// Design System §3.2 poster treatment: on the light ground pale posters
// dissolve into the surface without a hairline border + slight shadow — both
// applied unconditionally here since the token values (not this component)
// carry the light/dark difference. The hatched placeholder (Discovery.dc.html)
// covers the no-image case; a real posterPath renders the actual TMDB artwork
// the mockup couldn't ship (docs' README), at w185 per FR-TMDB-4.
export const HATCH_STYLE = {
    backgroundImage:
        'repeating-linear-gradient(135deg, color-mix(in oklab, var(--border) 70%, transparent) 0 1px, transparent 1px 9px)',
};

export function MovieCard({
    movie,
    badge,
    overlayBadge,
    meta,
    compact = false,
}: {
    movie: MovieSummary;
    // Renders in the footer row, after the release year — e.g. discover/search's
    // below-poster Save toggle.
    badge?: ReactNode;
    // Renders absolutely positioned over the poster's top-right corner — e.g.
    // saved-page.tsx's overlaid SAVED badge. Kept a sibling of the Link (never
    // nested inside it, same reasoning as `badge` below) by wrapping the Link
    // itself in the `relative` container rather than just the poster div: the
    // poster is the Link's first flex child, so its top-right corner and the
    // wrapper's are the same point.
    overlayBadge?: ReactNode;
    // Extra footer content after `badge` — e.g. saved-page.tsx's "saved X ago" timestamp.
    meta?: ReactNode;
    // Matches movie-detail-page.tsx's MovieHeading `compact` convention: a
    // smaller footer text size for denser grids (saved-page.tsx's own).
    compact?: boolean;
}) {
    const poster = posterUrl(movie.posterPath, 'w185');

    return (
        <div className='flex flex-col justify-between gap-2'>
            <div className='relative flex flex-1 flex-col gap-2'>
                {/* FR-DISC-4's entry point. `badge`/`overlayBadge` (Save, a <button>)
                    stay siblings outside the Link rather than nested inside it — an
                    interactive control inside an <a> is invalid HTML and would
                    double-fire on click (navigate + toggle). */}
                <Link to='/movie/$movieId' params={{ movieId: movie.tmdbId }} className='flex flex-1 flex-col gap-2'>
                    <div
                        className='border-border bg-raised aspect-2/3 overflow-hidden border shadow-[0_1px_2px_rgba(0,0,0,0.07)]'
                        style={poster ? undefined : HATCH_STYLE}
                    >
                        {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
                    </div>
                    <span className='text-text text-[13px] leading-tight font-semibold text-pretty'>{movie.title}</span>
                </Link>
                {overlayBadge && <div className='absolute top-1.75 right-1.75'>{overlayBadge}</div>}
            </div>
            <div className='flex items-center justify-between'>
                <span className={`text-muted font-mono ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                    {movie.releaseYear ?? '—'}
                </span>
                {badge}
                {meta}
            </div>
        </div>
    );
}
