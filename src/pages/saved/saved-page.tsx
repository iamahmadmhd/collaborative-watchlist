import { useSavedMovies, type SavedMovieRecord } from '../../features/save-movie/api/saved-movies';
import { SaveControl } from '../../features/save-movie/ui/save-control';
import { MovieCard } from '../../entities/movie/ui/movie-card';
import { formatRelativeTime } from '../../shared/lib/format-relative-time';
import { QueryState } from '../../shared/ui/query-state';

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
    return (
        <QueryState
            query={savedMoviesQuery}
            pending={
                <div className={gridClassName}>
                    {Array.from({ length: 12 }, (_, i) => (
                        <div key={i} className='border-border bg-raised aspect-2/3 animate-pulse rounded-sm border' />
                    ))}
                </div>
            }
            errorPrefix='Could not load saved films.'
            isEmpty={(data) => data.length === 0}
            empty={<p className='text-muted font-body text-sm'>No saved films yet.</p>}
        >
            {(data) => (
                <div className={gridClassName}>
                    {data.map((saved) => (
                        <SavedMovieCard key={saved.tmdbId} saved={saved} />
                    ))}
                </div>
            )}
        </QueryState>
    );
}

// docs/design/Saved.dc.html overlays the SAVED badge on the poster itself and
// adds a "saved X ago" timestamp beside the release year — entities/movie/ui/
// movie-card.tsx's MovieCard supports both via its overlayBadge/meta/compact
// props rather than this being a bespoke reimplementation.
function SavedMovieCard({ saved }: { saved: SavedMovieRecord }) {
    const movie = {
        tmdbId: saved.tmdbId,
        title: saved.title,
        posterPath: saved.posterPath ?? null,
        releaseYear: saved.releaseYear ?? null,
    };

    return (
        <MovieCard
            movie={movie}
            compact
            overlayBadge={<SaveControl movie={movie} isSaved={true} variant='badge' />}
            meta={
                saved.savedAt && (
                    <span className='text-muted font-mono text-[10px]'>{formatRelativeTime(saved.savedAt)}</span>
                )
            }
        />
    );
}
