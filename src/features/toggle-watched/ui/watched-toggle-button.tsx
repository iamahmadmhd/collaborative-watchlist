import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { tv } from 'tailwind-variants';
import { useToggleWatched } from '../api/watch-status';

// FR-WATCH-1: any member who can read this item — Owner, Editor, or Viewer
// alike — may toggle it, unlike the Editor-only remove control next to it in
// watchlist-detail-page.tsx. No gating prop here for that reason.
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
