import { useEffect, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { useSearchMovies } from '../../entities/movie/api/use-search-movies';
import { posterUrl, type MovieSummary } from '../../entities/movie/model/movie';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { SaveControl } from '../../features/save-movie/ui/save-control';
import { PaginationControls } from '../../shared/ui/pagination-controls';
import { QueryState } from '../../shared/ui/query-state';

const SEARCH_DEBOUNCE_MS = 300;

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
    // Tracked in a ref, mutated from onChange and never during render: the uncontrolled
    // input keyed by `query` below already handles both immediate typing and external
    // navigation without a render-synced copy to keep consistent.
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        return () => clearTimeout(debounceRef.current);
    }, []);

    // `q` lives in the URL, but committing on every keystroke would spam both browser
    // history and TMDB requests, so this fires only once typing pauses.
    function handleInputChange(value: string) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onQueryChange(value), SEARCH_DEBOUNCE_MS);
    }

    // Bypasses the debounce for an explicit clear.
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
                        value={query}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        hint='ESC'
                        onHintClick={() => void navigate({ to: '/discover', search: { page: 1 } })}
                    />
                </header>

                <div className='min-h-0 flex-1 overflow-y-auto px-7 pt-6'>
                    <SearchResultsHeader hasQuery={hasQuery} query={query} page={page} moviesQuery={moviesQuery} />
                    <SearchResultsList
                        moviesQuery={moviesQuery}
                        hasQuery={hasQuery}
                        savedSet={savedSet}
                        rowClassName='px-1'
                    />
                    {hasQuery && moviesQuery.data && moviesQuery.data.totalPages > 1 && (
                        <PaginationControls
                            page={page}
                            totalPages={moviesQuery.data.totalPages}
                            onPageChange={onPageChange}
                            info={
                                <span>
                                    page {page} / {Math.max(moviesQuery.data.totalPages, 1)}
                                </span>
                            }
                            className='justify-end py-4'
                        />
                    )}
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <div className='border-border bg-raised flex flex-none flex-col gap-2.5 border-b px-4 pt-11 pb-3'>
                    <SearchInput
                        value={query}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        hint='CLEAR'
                        onHintClick={() => commitQuery('')}
                    />
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto'>
                    <div className='px-4 pt-3'>
                        <SearchResultsHeader hasQuery={hasQuery} query={query} page={page} moviesQuery={moviesQuery} />
                    </div>
                    <SearchResultsList
                        moviesQuery={moviesQuery}
                        hasQuery={hasQuery}
                        savedSet={savedSet}
                        rowClassName='px-4'
                    />
                    {hasQuery && moviesQuery.data && moviesQuery.data.totalPages > 1 && (
                        <PaginationControls
                            page={page}
                            totalPages={moviesQuery.data.totalPages}
                            onPageChange={onPageChange}
                            info={
                                <span>
                                    page {page} / {Math.max(moviesQuery.data.totalPages, 1)}
                                </span>
                            }
                            className='justify-center px-4 py-5'
                        />
                    )}
                </div>
            </div>
        </>
    );
}

// Uncontrolled: the DOM holds the text, and `value` is only pushed in when it changes
// from outside this box — a back-navigation, or the ESC/CLEAR control. Remounting on
// every committed query instead would reset the caret to the end mid-edit.
function SearchInput({
    value,
    onChange,
    onKeyDown,
    hint,
    onHintClick,
}: {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    hint: string;
    onHintClick: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    // True while this box holds text the parent has not caught up to, which is what
    // stops an in-flight debounce from stomping the characters typed after it.
    const isDirtyRef = useRef(false);

    // Once per mount, so it cannot steal focus from something else on the page.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) {
            return;
        }
        if (input.value === value) {
            isDirtyRef.current = false;
            return;
        }
        if (isDirtyRef.current) {
            return;
        }
        input.value = value;
    }, [value]);

    return (
        <div className='border-accent bg-surface flex h-9.5 flex-1 items-center gap-2.5 rounded-[3px] border px-3 text-sm shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]'>
            <MagnifyingGlassIcon className='text-accent size-4 flex-none' />
            <input
                ref={inputRef}
                type='text'
                defaultValue={value}
                onChange={(event) => {
                    isDirtyRef.current = true;
                    onChange(event.target.value);
                }}
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
    page,
    moviesQuery,
}: {
    hasQuery: boolean;
    query: string;
    page: number;
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
                    page {page} / {Math.max(moviesQuery.data.totalPages, 1)} · {moviesQuery.data.totalResults} titles
                </span>
            )}
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

    return (
        <QueryState
            query={moviesQuery}
            pending={
                <div className='border-border border-t'>
                    {Array.from({ length: 6 }, (_, i) => (
                        <div
                            key={i}
                            className={`border-border flex items-center gap-4 border-b py-2.75 ${rowClassName}`}
                        >
                            <div className='bg-raised h-16.5 w-11 flex-none animate-pulse rounded-[1px]' />
                            <div className='bg-raised h-4 flex-1 animate-pulse rounded-[1px]' />
                        </div>
                    ))}
                </div>
            }
            errorPrefix='Could not search movies.'
            errorClassName={rowClassName}
        >
            {(data) => {
                // Narrows the generated nullability, as use-genres.ts does.
                const movies = data.results.filter((movie): movie is MovieSummary => movie != null);

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
            }}
        </QueryState>
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
            {/* SaveControl stays outside the Link, not nested inside it — see
                movie-card.tsx. */}
            <Link
                to='/movie/$movieId'
                params={{ movieId: movie.tmdbId }}
                className='flex min-w-0 flex-1 items-center gap-4'
            >
                <div className='border-border bg-raised h-16.5 w-11 flex-none overflow-hidden border'>
                    {poster && <img src={poster} alt='' className='h-full w-full object-cover' loading='lazy' />}
                </div>
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <span className='text-text truncate text-[15px] font-semibold'>{movie.title}</span>
                    <span className='text-muted font-mono text-xs'>{movie.releaseYear ?? '—'}</span>
                </div>
            </Link>
            <SaveControl movie={movie} isSaved={isSaved} variant='badge' />
        </div>
    );
}
