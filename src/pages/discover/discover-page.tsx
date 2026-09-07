import { useDiscoverMovies } from '../../entities/movie/api/use-discover-movies';
import type { MovieSummary } from '../../entities/movie/model/movie';
import { useGenres } from '../../entities/movie/api/use-genres';
import { MovieCard } from '../../entities/movie/ui/movie-card';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { SaveToggleButton } from '../../features/save-movie/ui/save-toggle-button';
import { GenreFilter } from '../../features/filter-discovery/ui/genre-filter';
import { ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid';

// docs/design/Discovery.dc.html. The header search box is presentational in
// the mock itself (a styled div, not an input, even there) — it's the entry
// point into the dedicated Search screen (docs' "02 Search"), not inline live
// search; it stays inert until that page exists (build order). Same reasoning
// for the mock's "2020s" decade pill: no FR backs a decade filter and
// `discoverMovies` takes no such argument (amplify/data/resource.ts) — CLAUDE.md
// says stop and ask rather than invent one, so it's left out rather than
// shipped as a control that does nothing.
export function DiscoverPage({
    genreId,
    page,
    onGenreChange,
    onPageChange,
}: {
    genreId: number | undefined;
    page: number;
    onGenreChange: (genreId: number | undefined) => void;
    onPageChange: (page: number) => void;
}) {
    const moviesQuery = useDiscoverMovies({ genreId, page });
    const { data: genres } = useGenres();
    const { data: savedSet } = useSavedSet();

    const activeGenreName = genreId !== undefined ? genres?.find((g) => g.id === genreId)?.name : undefined;
    const heading = activeGenreName ? activeGenreName : 'Trending this week';

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <header className='border-border bg-raised flex flex-none items-center gap-3 border-b px-7 py-4'>
                    <div className='border-border bg-surface text-muted flex h-9.5 flex-1 items-center gap-2.5 rounded-[3px] border px-3 text-sm'>
                        <MagnifyingGlassIcon className='size-4' />
                        <span>Search films by title</span>
                        <span className='border-border ml-auto rounded-xs border px-1.25 py-0.5 font-mono text-[10px]'>
                            /
                        </span>
                    </div>
                    <GenreFilter genreId={genreId} onChange={onGenreChange} />
                </header>

                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-6'>
                    <div className='mb-4 flex items-baseline justify-between'>
                        <h1 className='font-display text-text m-0 text-[26px] font-bold tracking-[-0.02em]'>
                            {heading}
                        </h1>
                        <PaginationControls moviesQuery={moviesQuery} page={page} onPageChange={onPageChange} />
                    </div>
                    <MovieGrid
                        moviesQuery={moviesQuery}
                        savedSet={savedSet}
                        gridClassName='grid grid-cols-6 gap-x-4 gap-y-[18px]'
                    />
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <div className='border-border bg-raised flex flex-none flex-col gap-2.5 border-b px-4 py-2.5'>
                    <div className='flex items-baseline justify-between'>
                        <span className='font-display text-text text-[17px] font-bold tracking-[-0.02em]'>
                            Repertory
                        </span>
                    </div>
                    <div className='border-border bg-surface text-muted flex h-9 items-center gap-2.25 rounded-[3px] border px-2.75 text-sm'>
                        <span className='border-muted h-2.75 w-2.75 rounded-full border-[1.5px]' />
                        <span>Search films</span>
                    </div>
                    <div className='mt-1'>
                        <GenreFilter genreId={genreId} onChange={onGenreChange} />
                    </div>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <MovieGrid
                        moviesQuery={moviesQuery}
                        savedSet={savedSet}
                        gridClassName='grid grid-cols-3 gap-x-3 gap-y-4'
                    />
                    {/* FR-DISC-5: the board's mobile frame doesn't show pagination at
                        all (it's a fixed-height preview frame cut off below the
                        fold), but the requirement — and the URL page state — apply
                        here exactly as on desktop, so this is the faithful-adaptation
                        equivalent, not new scope. */}
                    <PaginationControls
                        moviesQuery={moviesQuery}
                        page={page}
                        onPageChange={onPageChange}
                        className='justify-center pt-5'
                    />
                </div>
            </div>
        </>
    );
}

function PaginationControls({
    moviesQuery,
    page,
    onPageChange,
    className,
}: {
    moviesQuery: ReturnType<typeof useDiscoverMovies>;
    page: number;
    onPageChange: (page: number) => void;
    className?: string;
}) {
    if (!moviesQuery.data) {
        return null;
    }
    const { totalPages, totalResults } = moviesQuery.data;

    return (
        <div className={`text-muted flex items-center gap-3 font-mono text-[11px] ${className ?? ''}`}>
            <span>
                page {moviesQuery.data.page} / {Math.max(totalPages, 1)} · {totalResults} titles
            </span>
            {/* -m-1.5 p-1.5 keeps the visual size unchanged while giving the
                button a >=44px hit area (mobile's own touch-target convention,
                e.g. tab-bar.tsx's min-h-11) without needing separate mobile markup. */}
            <button
                type='button'
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className='disabled:text-border enabled:hover:text-text -m-1.5 flex items-center p-1.5 disabled:cursor-not-allowed'
            >
                <ChevronLeftIcon className='size-4' /> prev
            </button>
            <button
                type='button'
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                className='disabled:text-border enabled:hover:text-text -m-1.5 flex items-center p-1.5 disabled:cursor-not-allowed'
            >
                next <ChevronRightIcon className='size-4' />
            </button>
        </div>
    );
}

function MovieGrid({
    moviesQuery,
    savedSet,
    gridClassName,
}: {
    moviesQuery: ReturnType<typeof useDiscoverMovies>;
    savedSet: Set<string> | undefined;
    gridClassName: string;
}) {
    if (moviesQuery.isPending) {
        return (
            <div className={gridClassName}>
                {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className='border-border bg-raised aspect-2/3 animate-pulse rounded-sm border' />
                ))}
            </div>
        );
    }

    if (moviesQuery.isError) {
        return (
            <p className='text-danger font-body text-sm' role='alert'>
                Could not load movies. {moviesQuery.error instanceof Error ? moviesQuery.error.message : ''}
            </p>
        );
    }

    // Same generated-nullability note as use-genres.ts's filter.
    const movies = moviesQuery.data.results.filter((movie): movie is MovieSummary => movie != null);

    if (movies.length === 0) {
        return <p className='text-muted font-body text-sm'>No films found.</p>;
    }

    return (
        <div className={gridClassName}>
            {movies.map((movie) => (
                <MovieCard
                    key={movie.tmdbId}
                    movie={movie}
                    badge={<SaveToggleButton movie={movie} isSaved={savedSet?.has(movie.tmdbId) ?? false} />}
                />
            ))}
        </div>
    );
}
