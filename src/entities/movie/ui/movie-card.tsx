import type { ReactNode } from 'react';
import { posterUrl, type MovieSummary } from '../model/movie';

// Design System §3.2 poster treatment: on the light ground pale posters
// dissolve into the surface without a hairline border + slight shadow — both
// applied unconditionally here since the token values (not this component)
// carry the light/dark difference. The hatched placeholder (Discovery.dc.html)
// covers the no-image case; a real posterPath renders the actual TMDB artwork
// the mockup couldn't ship (docs' README), at w185 per FR-TMDB-4.
const HATCH_STYLE = {
    backgroundImage:
        'repeating-linear-gradient(135deg, color-mix(in oklab, var(--border) 70%, transparent) 0 1px, transparent 1px 9px)',
};

export function MovieCard({ movie, badge }: { movie: MovieSummary; badge?: ReactNode }) {
    const poster = posterUrl(movie.posterPath, 'w185');

    return (
        <div className='flex flex-col justify-between gap-2'>
            <div
                className='border-border bg-raised aspect-2/3 overflow-hidden border shadow-[0_1px_2px_rgba(0,0,0,0.07)]'
                style={poster ? undefined : HATCH_STYLE}
            >
                {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
            </div>
            <div className='flex flex-1 flex-col justify-between gap-0.75'>
                <span className='text-text text-[13px] leading-tight font-semibold text-pretty'>{movie.title}</span>
                <div className='flex items-center justify-between'>
                    <span className='text-muted font-mono text-[11px]'>{movie.releaseYear ?? '—'}</span>
                    {badge}
                </div>
            </div>
        </div>
    );
}
