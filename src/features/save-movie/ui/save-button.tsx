import { tv } from 'tailwind-variants';
import { useToggleSave } from '../api/saved-movies';
import type { MovieSummary } from '../../../entities/movie/model/movie';

// docs/design/Movie Detail.dc.html's full-width "Saved to your films" /
// "Add to watchlist" pair. Only the save half is built here — "Add to
// watchlist" has nowhere to go yet (no Watchlists feature/page exists, build
// order) — same reasoning save-toggle-button.tsx's grid badge already
// established for FR-SAVE-1, just the movie-detail-sized control.
const button = tv({
    base: 'font-body flex h-10.5 items-center justify-center gap-2 rounded-[3px] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        saved: {
            true: 'bg-accent text-accent-contrast',
            false: 'border-border text-text border',
        },
    },
});

export function SaveButton({ movie, isSaved }: { movie: MovieSummary; isSaved: boolean }) {
    const toggleSave = useToggleSave();

    return (
        <button
            type='button'
            onClick={() => toggleSave.mutate({ movie, isSaved })}
            disabled={toggleSave.isPending}
            aria-pressed={isSaved}
            className={button({ saved: isSaved })}
        >
            {isSaved ? 'Saved to your films' : 'Save to your films'}
        </button>
    );
}
