import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MagnifyingGlassIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import { useSearchMovies } from '../../entities/movie/api/use-search-movies';
import { posterUrl, type MovieSummary } from '../../entities/movie/model/movie';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { SaveToggleButton } from '../../features/save-movie/ui/save-toggle-button';

const SEARCH_DEBOUNCE_MS = 300;

// docs/design/Search.dc.html. Two things the mock shows that this page
// deliberately doesn't reproduce:
// - The "Drama ▼" genre pill: `searchMovies` (amplify/data/resource.ts) takes
//   only `query`/`page`, no genre argument — same reasoning as discover-page.tsx's
//   dropped "2020s" pill, no FR backs genre-filtered search and there's no
//   argument to invent one against.
// - The suggestions dropdown and each result's "blurb"/genre columns: both need
//   data `MovieSummary` doesn't carry (no synopsis/genre fields — only
//   tmdbId/title/posterPath/releaseYear, entities/movie/model/movie.ts) or a
//   destination that doesn't exist yet (a suggestion's natural target is Movie
//   Detail, which isn't built — build order, same logic as shell-sidebar.tsx's
//   inert nav rows).
export function SearchPage({
    query,
    page,
    onQueryChange,
    onPageChange,
}: {
    query: string;
    page: number;
    onQueryChange: (query: string) => void;
    onPageChange: (page: number) => void;
}) {
    const navigate = useNavigate();
    // Debounce is tracked via a ref (mutated from the input's own onChange
    // event handler, never during render) rather than component state — an
    // uncontrolled input, keyed by `query` below, already handles both "typed
    // value renders immediately" and "external navigation updates the field"
    // without a render-synced copy of `query` to keep consistent.
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        return () => clearTimeout(debounceRef.current);
    }, []);

    // FR-DISC-5 puts `q` in the URL, but committing it on every keystroke would
    // spam both browser history and TMDB requests, so this only fires once
    // typing pauses.
    function handleInputChange(value: string) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onQueryChange(value), SEARCH_DEBOUNCE_MS);
    }

    // Bypasses the debounce for an explicit clear (mobile's "CLEAR" hint).
    function commitQuery(value: string) {
        clearTimeout(debounceRef.current);
        onQueryChange(value);
    }

    const moviesQuery = useSearchMovies({ query, page });
    const { data: savedSet } = useSavedSet();
    const hasQuery = query.trim().length > 0;

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Escape') {
            void navigate({ to: '/discover', search: { page: 1 } });
        }
    }

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <header className='border-border bg-raised flex flex-none items-center gap-3 border-b px-7 py-4'>
                    <SearchInput
                        key={query}
                        defaultValue={query}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        hint='ESC'
                        onHintClick={() => void navigate({ to: '/discover', search: { page: 1 } })}
                    />
                </header>

                <div className='min-h-0 flex-1 overflow-y-auto px-7 pt-6'>
                    <SearchResultsHeader hasQuery={hasQuery} query={query} moviesQuery={moviesQuery} />
                    <SearchResultsList
                        moviesQuery={moviesQuery}
                        hasQuery={hasQuery}
                        savedSet={savedSet}
                        rowClassName='px-1'
                    />
                    {hasQuery && moviesQuery.data && moviesQuery.data.totalPages > 1 && (
                        <PaginationControls
                            moviesQuery={moviesQuery}
                            page={page}
                            onPageChange={onPageChange}
                            className='justify-end py-4'
                        />
                    )}
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <div className='border-border bg-raised flex flex-none flex-col gap-2.5 border-b px-4 pt-11 pb-3'>
                    <SearchInput
                        key={query}
                        defaultValue={query}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        hint='CLEAR'
                        onHintClick={() => commitQuery('')}
                    />
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto'>
                    <div className='px-4 pt-3'>
                        <SearchResultsHeader hasQuery={hasQuery} query={query} moviesQuery={moviesQuery} />
                    </div>
                    <SearchResultsList
                        moviesQuery={moviesQuery}
                        hasQuery={hasQuery}
                        savedSet={savedSet}
                        rowClassName='px-4'
                    />
                    {hasQuery && moviesQuery.data && moviesQuery.data.totalPages > 1 && (
                        <PaginationControls
                            moviesQuery={moviesQuery}
                            page={page}
                            onPageChange={onPageChange}
                            className='justify-center px-4 py-5'
                        />
                    )}
                </div>
            </div>
        </>
    );
}

// Uncontrolled by design: the parent remounts this (via `key={query}`)
// whenever `query` changes for any reason — the debounce committing, back/
// forward navigation, a shared link — so there's no controlled `value` to
// keep in sync, and no risk of the two falling out of step.
function SearchInput({
    defaultValue,
    onChange,
    onKeyDown,
    hint,
    onHintClick,
}: {
    defaultValue: string;
    onChange: (value: string) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    hint: string;
    onHintClick: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Runs once per mount, i.e. once per `query`-driven remount — never on an
    // unrelated re-render (a movies-query refetch, a saved-set update), so it
    // never steals focus from something else on the page.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    return (
        <div className='border-accent bg-surface flex h-9.5 flex-1 items-center gap-2.5 rounded-[3px] border px-3 text-sm shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]'>
            <MagnifyingGlassIcon className='text-accent size-4 flex-none' />
            <input
                ref={inputRef}
                type='text'
                defaultValue={defaultValue}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder='Search films by title'
                aria-label='Search films by title'
                className='text-text placeholder:text-muted min-w-0 flex-1 bg-transparent outline-none'
            />
            <button
                type='button'
                onClick={onHintClick}
                className='border-border text-muted hover:text-text ml-auto flex-none rounded-xs border px-1.25 py-0.5 font-mono text-[10px]'
            >
                {hint}
            </button>
        </div>
    );
}

function SearchResultsHeader({
    hasQuery,
    query,
    moviesQuery,
}: {
    hasQuery: boolean;
    query: string;
    moviesQuery: ReturnType<typeof useSearchMovies>;
}) {
    if (!hasQuery) {
        return null;
    }

    return (
        <div className='mb-3.5 flex items-baseline justify-between gap-3'>
            <h1 className='font-display text-text m-0 truncate text-[24px] font-bold tracking-[-0.02em]'>
                Results for &ldquo;{query}&rdquo;
            </h1>
            {moviesQuery.data && (
                <span className='text-muted flex-none font-mono text-[11px]'>
                    page {moviesQuery.data.page} / {Math.max(moviesQuery.data.totalPages, 1)} ·{' '}
                    {moviesQuery.data.totalResults} titles
                </span>
            )}
        </div>
    );
}

function PaginationControls({
    moviesQuery,
    page,
    onPageChange,
    className,
}: {
    moviesQuery: ReturnType<typeof useSearchMovies>;
    page: number;
    onPageChange: (page: number) => void;
    className?: string;
}) {
    if (!moviesQuery.data) {
        return null;
    }
    const { totalPages } = moviesQuery.data;

    return (
        <div className={`text-muted flex items-center gap-3 font-mono text-[11px] ${className ?? ''}`}>
            <button
                type='button'
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className='disabled:text-border enabled:hover:text-text -m-1.5 flex items-center p-1.5 disabled:cursor-not-allowed'
            >
                <ChevronLeftIcon className='size-4' /> prev
            </button>
            <span>
                page {page} / {Math.max(totalPages, 1)}
            </span>
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

function SearchResultsList({
    moviesQuery,
    hasQuery,
    savedSet,
    rowClassName,
}: {
    moviesQuery: ReturnType<typeof useSearchMovies>;
    hasQuery: boolean;
    savedSet: Set<string> | undefined;
    rowClassName: string;
}) {
    if (!hasQuery) {
        return (
            <p className={`text-muted font-body text-sm ${rowClassName}`}>Type a film title above to search TMDB.</p>
        );
    }

    if (moviesQuery.isPending) {
        return (
            <div className='border-border border-t'>
                {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className={`border-border flex items-center gap-4 border-b py-2.75 ${rowClassName}`}>
                        <div className='bg-raised h-16.5 w-11 flex-none animate-pulse rounded-[1px]' />
                        <div className='bg-raised h-4 flex-1 animate-pulse rounded-[1px]' />
                    </div>
                ))}
            </div>
        );
    }

    if (moviesQuery.isError) {
        return (
            <p className={`text-danger font-body text-sm ${rowClassName}`} role='alert'>
                Could not search movies. {moviesQuery.error instanceof Error ? moviesQuery.error.message : ''}
            </p>
        );
    }

    // Same generated-nullability note as use-genres.ts's filter.
    const movies = moviesQuery.data.results.filter((movie): movie is MovieSummary => movie != null);

    if (movies.length === 0) {
        return <p className={`text-muted font-body text-sm ${rowClassName}`}>No films found.</p>;
    }

    return (
        <div className='border-border border-t'>
            {movies.map((movie) => (
                <SearchResultRow
                    key={movie.tmdbId}
                    movie={movie}
                    isSaved={savedSet?.has(movie.tmdbId) ?? false}
                    rowClassName={rowClassName}
                />
            ))}
        </div>
    );
}

function SearchResultRow({
    movie,
    isSaved,
    rowClassName,
}: {
    movie: MovieSummary;
    isSaved: boolean;
    rowClassName: string;
}) {
    const poster = posterUrl(movie.posterPath, 'w185');

    return (
        <div className={`border-border flex items-center gap-4 border-b py-2.75 ${rowClassName}`}>
            <div className='border-border bg-raised h-16.5 w-11 flex-none overflow-hidden border'>
                {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
            </div>
            <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <span className='text-text truncate text-[15px] font-semibold'>{movie.title}</span>
                <span className='text-muted font-mono text-xs'>{movie.releaseYear ?? '—'}</span>
            </div>
            <SaveToggleButton movie={movie} isSaved={isSaved} />
        </div>
    );
}
