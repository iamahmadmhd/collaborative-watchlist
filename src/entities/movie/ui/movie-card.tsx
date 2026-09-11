import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { posterUrl, type MovieSummary } from '../model/movie';

// The hairline border and shadow are applied unconditionally: on the light ground pale
// posters dissolve into the surface without them, and the tokens carry the light/dark
// difference themselves.
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
    // Renders in the footer row, after the release year.
    badge?: ReactNode;
    // Positioned over the poster's top-right corner. Kept a sibling of the Link rather
    // than nested inside it: the `relative` container wraps the Link, whose first flex
    // child is the poster, so the two share that corner.
    overlayBadge?: ReactNode;
    // Extra footer content after `badge`.
    meta?: ReactNode;
    // Smaller footer text for denser grids.
    compact?: boolean;
}) {
    const poster = posterUrl(movie.posterPath, 'w185');

    return (
        <div className='flex flex-col justify-between gap-2'>
            <div className='relative flex flex-1 flex-col gap-2'>
                {/* `badge`/`overlayBadge` stay siblings outside the Link: an interactive
                    control inside an <a> is invalid HTML and double-fires on click. */}
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
