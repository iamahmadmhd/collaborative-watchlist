import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { tv } from 'tailwind-variants';
import { useToggleWatched } from '../api/watch-status';

// Any member who can read the item may toggle it, Viewers included — unlike the
// Editor-only remove control beside it, so there is no gating prop here.
const toggle = tv({
    base: 'flex flex-none items-center justify-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        watched: {
            true: 'text-ok',
            false: 'text-muted hover:text-ok',
        },
    },
});

export function WatchedToggleButton({
    watchlistId,
    tmdbId,
    title,
    isWatched,
    className,
}: {
    watchlistId: string;
    tmdbId: string;
    title: string;
    isWatched: boolean;
    className?: string | undefined;
}) {
    const toggleWatched = useToggleWatched(watchlistId);

    return (
        <button
            type='button'
            aria-label={isWatched ? `Mark ${title} as unwatched` : `Mark ${title} as watched`}
            aria-pressed={isWatched}
            onClick={() => toggleWatched.mutate({ tmdbId, isWatched })}
            disabled={toggleWatched.isPending}
            className={toggle({ watched: isWatched, className })}
        >
            <CheckCircleIcon className='size-4' /> watched
        </button>
    );
}
