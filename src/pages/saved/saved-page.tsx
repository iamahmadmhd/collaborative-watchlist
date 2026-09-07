import { Link } from '@tanstack/react-router';
import { useSavedMovies, type SavedMovieRecord } from '../../features/save-movie/api/saved-movies';
import { SaveToggleButton } from '../../features/save-movie/ui/save-toggle-button';
import { HATCH_STYLE } from '../../entities/movie/ui/movie-card';
import { posterUrl } from '../../entities/movie/model/movie';
import { formatRelativeTime } from '../../shared/lib/format-relative-time';

// docs/design/Saved.dc.html. The header's "Newest first ▼" and "All genres ▼"
// pills are left out — same reasoning discover-page.tsx already established for
// its dropped "2020s" pill: sort order is a fixed query-time guarantee here
// (System Design §5.2 access pattern 1, the byUserAndDate index), not a user
// choice, and SavedMovie carries no genre field to filter by. Shipping either
// as a non-functional control would be inventing scope CLAUDE.md says to ask
// about instead.
export function SavedPage() {
    const savedMoviesQuery = useSavedMovies();
    const count = savedMoviesQuery.data?.length;

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <header className='border-border bg-raised flex flex-none items-end justify-between border-b px-7 py-5.5'>
                    <div className='flex flex-col gap-1.5'>
                        <h1 className='font-display text-text m-0 text-[30px] font-bold tracking-[-0.025em]'>
                            Saved films
                        </h1>
                        {/* FR-SAVE-4's "private to no one else" guarantee, stated in the
                            copy itself rather than left implicit. */}
                        <span className='text-muted font-mono text-[11px]'>
                            {count === undefined ? '…' : `${count} film${count === 1 ? '' : 's'}`} · private to you
                        </span>
                    </div>
                </header>
                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-5.5'>
                    <SavedMoviesGrid
                        savedMoviesQuery={savedMoviesQuery}
                        gridClassName='grid grid-cols-6 gap-x-4 gap-y-5'
                    />
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <div className='border-border bg-raised flex flex-none flex-col gap-2.5 border-b px-4 pt-11 pb-3'>
                    <h1 className='font-display text-text m-0 text-[24px] font-bold tracking-[-0.02em]'>Saved films</h1>
                    <span className='text-muted font-mono text-[11px]'>
                        {count === undefined ? '…' : `${count} FILM${count === 1 ? '' : 'S'}`}
                    </span>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <SavedMoviesGrid
                        savedMoviesQuery={savedMoviesQuery}
                        gridClassName='grid grid-cols-2 gap-x-3.5 gap-y-[18px]'
                    />
                </div>
            </div>
        </>
    );
}

function SavedMoviesGrid({
    savedMoviesQuery,
    gridClassName,
}: {
    savedMoviesQuery: ReturnType<typeof useSavedMovies>;
    gridClassName: string;
}) {
    if (savedMoviesQuery.isPending) {
        return (
            <div className={gridClassName}>
                {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className='border-border bg-raised aspect-2/3 animate-pulse rounded-sm border' />
                ))}
            </div>
        );
    }

    if (savedMoviesQuery.isError) {
        return (
            <p className='text-danger font-body text-sm' role='alert'>
                Could not load saved films.{' '}
                {savedMoviesQuery.error instanceof Error ? savedMoviesQuery.error.message : ''}
            </p>
        );
    }

    if (savedMoviesQuery.data.length === 0) {
        return <p className='text-muted font-body text-sm'>No saved films yet.</p>;
    }

    return (
        <div className={gridClassName}>
            {savedMoviesQuery.data.map((saved) => (
                <SavedMovieCard key={saved.tmdbId} saved={saved} />
            ))}
        </div>
    );
}

// A bespoke card rather than entities/movie/ui/movie-card.tsx's MovieCard: the
// mock overlays the SAVED badge on the poster itself and adds a "saved X ago"
// timestamp beside the release year, neither of which MovieCard's below-poster
// `badge` slot supports — same reasoning search-page.tsx's own SearchResultRow
// is a page-local component rather than a forced reuse.
function SavedMovieCard({ saved }: { saved: SavedMovieRecord }) {
    const poster = posterUrl(saved.posterPath, 'w185');
    const movie = {
        tmdbId: saved.tmdbId,
        title: saved.title,
        posterPath: saved.posterPath ?? null,
        releaseYear: saved.releaseYear ?? null,
    };

    return (
        <div className='flex flex-col justify-between gap-2'>
            {/* `relative` wraps the Link rather than just the poster div so the
                badge below can stay a sibling of the Link (never nested inside
                it — an interactive control inside an <a> is invalid HTML and
                would double-fire on click, movie-card.tsx's same reasoning)
                while still overlaying the poster's exact top-right corner: the
                poster is the Link's first flex child, so its top-right corner
                and the wrapper's are the same point. */}
            <div className='relative flex flex-1 flex-col gap-2'>
                <Link to='/movie/$movieId' params={{ movieId: saved.tmdbId }} className='flex flex-1 flex-col gap-2'>
                    <div
                        className='border-border bg-raised aspect-2/3 overflow-hidden border shadow-[0_1px_2px_rgba(0,0,0,0.07)]'
                        style={poster ? undefined : HATCH_STYLE}
                    >
                        {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
                    </div>
                    <span className='text-text text-[13px] leading-tight font-semibold text-pretty'>{saved.title}</span>
                </Link>
                <div className='absolute top-1.75 right-1.75'>
                    <SaveToggleButton movie={movie} isSaved={true} />
                </div>
            </div>
            <div className='flex items-center justify-between'>
                <span className='text-muted font-mono text-[10px]'>{saved.releaseYear ?? '—'}</span>
                {saved.savedAt && (
                    <span className='text-muted font-mono text-[10px]'>{formatRelativeTime(saved.savedAt)}</span>
                )}
            </div>
        </div>
    );
}
