import { tv } from 'tailwind-variants';
import { useToggleSave } from '../api/saved-movies';
import type { MovieSummary } from '../../../entities/movie/model/movie';

// Two visual treatments of one control: `badge` for the compact grid overlay, `button`
// for movie detail's full-width version. Both drive the same mutation, so only styling
// and label differ.
const button = tv({
    base: 'font-body flex h-10.5 items-center justify-center gap-2 rounded-[3px] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        saved: {
            true: 'bg-accent text-accent-contrast',
            false: 'border-border text-text border',
        },
    },
});

const badge = tv({
    base: 'rounded-[2px] border px-1.25 py-0.5 font-mono text-[9px] tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        saved: {
            true: 'border-accent bg-accent text-accent-contrast',
            false: 'border-border text-muted bg-transparent',
        },
    },
});

export function SaveControl({
    movie,
    isSaved,
    variant,
}: {
    movie: MovieSummary;
    isSaved: boolean;
    variant: 'button' | 'badge';
}) {
    const toggleSave = useToggleSave();
    const className = variant === 'button' ? button({ saved: isSaved }) : badge({ saved: isSaved });
    const label =
        variant === 'button' ? (isSaved ? 'Saved to your films' : 'Save to your films') : isSaved ? 'SAVED' : 'SAVE';

    return (
        <button
            type='button'
            onClick={() => toggleSave.mutate({ movie, isSaved })}
            disabled={toggleSave.isPending}
            aria-pressed={isSaved}
            className={className}
        >
            {label}
        </button>
    );
}
