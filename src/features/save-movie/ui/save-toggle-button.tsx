import { tv } from 'tailwind-variants';
import { useToggleSave } from '../api/saved-movies';
import type { MovieSummary } from '../../../entities/movie/model/movie';

// Visual language matches Discovery.dc.html's SAVE/SAVED badge exactly; the
// mock's badge is static, this makes it the actual FR-SAVE-1 control.
const badge = tv({
    base: 'rounded-[2px] border px-1.25 py-0.5 font-mono text-[9px] tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        saved: {
            true: 'border-accent bg-accent text-accent-contrast',
            false: 'border-border text-muted bg-transparent',
        },
    },
});

export function SaveToggleButton({ movie, isSaved }: { movie: MovieSummary; isSaved: boolean }) {
    const toggleSave = useToggleSave();

    return (
        <button
            type='button'
            onClick={() => toggleSave.mutate({ movie, isSaved })}
            disabled={toggleSave.isPending}
            aria-pressed={isSaved}
            className={badge({ saved: isSaved })}
        >
            {isSaved ? 'SAVED' : 'SAVE'}
        </button>
    );
}
