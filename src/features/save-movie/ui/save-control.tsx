import { tv } from 'tailwind-variants';
import { useToggleSave } from '../api/saved-movies';
import type { MovieSummary } from '../../../entities/movie/model/movie';

// FR-SAVE-1's control, in the two visual treatments docs/design ships for it —
// `badge` (Discovery.dc.html/Search.dc.html's compact SAVE/SAVED grid badge) and
// `button` (Movie Detail.dc.html's full-width "Save to your films" control).
// Both drive the same useToggleSave mutation; only the tv() styling and label
// differ, so this is one component with a variant prop (matching this
// codebase's own precedent, shared/ui/theme-toggle.tsx's `cards`/`segment`
// variants) rather than two near-identical wrapper components.
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
