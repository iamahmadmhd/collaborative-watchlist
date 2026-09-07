import { useMovieDetail, type NormalizedMovieDetail } from '../../entities/movie/api/use-movie-detail';
import { HATCH_STYLE } from '../../entities/movie/ui/movie-card';
import { posterUrl, releaseYearOf, type CastMember } from '../../entities/movie/model/movie';
import { useSavedSet } from '../../features/save-movie/api/saved-movies';
import { SaveButton } from '../../features/save-movie/ui/save-button';
import { AddToListMenu } from '../../features/manage-list-items/ui/add-to-list-menu';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';

// docs/design/Movie Detail.dc.html. Two things the mock shows that this page
// deliberately doesn't reproduce, neither backed by data this app actually has:
// - "IN 2 OF YOUR LISTS": would need a per-list membership count summarised
//   across every list this member belongs to, which isn't a documented access
//   pattern (System Design §5.2) — AddToListMenu's own checkboxes already show
//   this per-list on demand, which is what FR-ITEM-1 actually asks for.
// - The meta line's country/language/rating (HONG KONG · CANTONESE · 7.9/10):
//   `MovieDetail` (amplify/data/resource.ts) carries none of these — TMDB's
//   raw response isn't proxied through, tmdb-schemas.ts only maps the fields
//   FR-DISC-4 actually lists.
// - The "CREDITS" grid (DIRECTOR/CINEMATOGRAPHY/EDITING/RELEASED): TMDB's
//   response is fetched with `append_to_response=credits` (tmdb-client.ts),
//   but only `credits.cast` is mapped — "FR-DISC-4 asks for 'cast', not the
//   full crew list" per that file's own comment. RELEASED alone isn't worth a
//   single-item grid section, so the release date is folded into the meta
//   line instead.
export function MovieDetailPage({ movieId }: { movieId: string }) {
    const movieQuery = useMovieDetail(movieId);
    const { data: savedSet } = useSavedSet();

    function handleBack() {
        window.history.back();
    }

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <DetailHeader onBack={handleBack} />
                <MovieDetailContent movieQuery={movieQuery} savedSet={savedSet} variant='desktop' />
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <MobileHeader onBack={handleBack} />
                <MovieDetailContent movieQuery={movieQuery} savedSet={savedSet} variant='mobile' />
            </div>
        </>
    );
}

function DetailHeader({ onBack }: { onBack: () => void }) {
    return (
        <header className='border-border bg-raised flex flex-none items-center gap-3.5 border-b px-7 py-3.5'>
            <button
                type='button'
                onClick={onBack}
                className='text-muted hover:text-text flex items-center gap-2 font-mono text-[11px] tracking-[0.02em]'
            >
                <ArrowLeftIcon className='size-4' /> BACK TO RESULTS
            </button>
        </header>
    );
}

function MobileHeader({ onBack }: { onBack: () => void }) {
    return (
        <div className='border-border bg-raised flex flex-none items-center justify-between px-4 pt-11 pb-2.5'>
            <button type='button' onClick={onBack} className='text-muted flex items-center gap-2 font-mono text-[11px]'>
                <ArrowLeftIcon className='size-4' /> BACK
            </button>
        </div>
    );
}

// Mirrors discover-page.tsx's MovieGrid/search-page.tsx's SearchResultsList:
// one component holding the pending/error/success branches, invoked once per
// breakpoint so each gets its own appropriately-shaped skeleton/error/content
// rather than a single non-responsive state hoisted above the layout split.
function MovieDetailContent({
    movieQuery,
    savedSet,
    variant,
}: {
    movieQuery: ReturnType<typeof useMovieDetail>;
    savedSet: Set<string> | undefined;
    variant: 'desktop' | 'mobile';
}) {
    if (movieQuery.isPending) {
        return variant === 'desktop' ? <DesktopSkeleton /> : <MobileSkeleton />;
    }

    if (movieQuery.isError) {
        return (
            <p className='text-danger font-body p-7 text-sm' role='alert'>
                Could not load this film. {movieQuery.error instanceof Error ? movieQuery.error.message : ''}
            </p>
        );
    }

    const movie = movieQuery.data;
    const poster = posterUrl(movie.posterPath, 'w500');
    const releaseDate = formatReleaseDate(movie.releaseDate);
    const isSaved = savedSet?.has(movie.tmdbId) ?? false;
    const movieSummary = {
        tmdbId: movie.tmdbId,
        title: movie.title,
        posterPath: movie.posterPath ?? null,
        releaseYear: releaseYearOf(movie.releaseDate),
    };

    if (variant === 'desktop') {
        return (
            <>
                <div className='grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-10 overflow-y-auto p-8'>
                    <aside className='flex flex-col gap-3.5'>
                        <Poster poster={poster} className='aspect-2/3' />
                        <SaveButton movie={movieSummary} isSaved={isSaved} />
                        <AddToListMenu movie={movieSummary} />
                    </aside>
                    <div className='flex min-w-0 flex-col gap-5'>
                        <MovieHeading movie={movie} releaseDate={releaseDate} titleClassName='text-[36px]' />
                        {movie.genres.length > 0 && (
                            <div className='-mt-3 flex flex-wrap gap-1.75'>
                                {movie.genres.map((genre) => (
                                    <span
                                        key={genre.id}
                                        className='border-border text-muted rounded-xs border px-2 py-1 font-mono text-[10px] tracking-[0.06em]'
                                    >
                                        {genre.name.toUpperCase()}
                                    </span>
                                ))}
                            </div>
                        )}
                        {movie.overview && (
                            <p className='font-body text-text max-w-160 text-base leading-relaxed text-pretty'>
                                {movie.overview}
                            </p>
                        )}
                        <CastSection cast={movie.cast} className='border-border border-t pt-4.5' />
                    </div>
                </div>
            </>
        );
    }

    return (
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
            <div className='flex gap-3.5'>
                <Poster poster={poster} className='aspect-2/3 w-29.5 flex-none' />
                <div className='flex min-w-0 flex-col gap-2'>
                    <MovieHeading movie={movie} releaseDate={releaseDate} titleClassName='text-[26px]' compact />
                    {movie.genres.length > 0 && (
                        <span className='text-muted text-xs'>
                            {movie.genres.map((genre) => genre.name).join(' · ')}
                        </span>
                    )}
                </div>
            </div>
            <div className='flex flex-col gap-2.5 pt-4'>
                <SaveButton movie={movieSummary} isSaved={isSaved} />
                <AddToListMenu movie={movieSummary} />
            </div>
            {movie.overview && (
                <p className='font-body text-text pt-4 text-[15px] leading-relaxed text-pretty'>{movie.overview}</p>
            )}
            <CastSection cast={movie.cast} className='pt-4.5' />
        </div>
    );
}

function Poster({ poster, className }: { poster: string | null; className: string }) {
    return (
        <div
            className={`border-border bg-raised overflow-hidden border shadow-[0_2px_6px_rgba(0,0,0,0.1)] ${className}`}
            style={poster ? undefined : HATCH_STYLE}
        >
            {poster && <img src={poster} alt='' className='h-full w-full object-cover' />}
        </div>
    );
}

function MovieHeading({
    movie,
    releaseDate,
    titleClassName,
    compact = false,
}: {
    movie: NormalizedMovieDetail;
    releaseDate: string | null;
    titleClassName: string;
    compact?: boolean;
}) {
    return (
        <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-2.5'}`}>
            <h1
                className={`font-display text-text m-0 leading-[1.05] font-bold tracking-[-0.02em] text-pretty ${titleClassName}`}
            >
                {movie.title}
            </h1>
            <div
                className={`text-muted flex flex-wrap items-center font-mono ${compact ? 'gap-2 text-[11px]' : 'gap-3.5 text-xs'}`}
            >
                {releaseDate && <span>{releaseDate}</span>}
                {movie.runtimeMinutes != null && <span>{movie.runtimeMinutes} MIN</span>}
            </div>
        </div>
    );
}

function CastSection({ cast, className }: { cast: CastMember[]; className?: string }) {
    if (cast.length === 0) {
        return null;
    }

    return (
        <div className={`flex flex-col gap-3 ${className ?? ''}`}>
            <span className='text-muted font-mono text-[10px] tracking-[0.08em]'>CAST</span>
            <div className='flex gap-5 overflow-x-auto pb-1'>
                {cast.map((castMember) => {
                    const photo = posterUrl(castMember.profilePath, 'w185');
                    return (
                        <div key={castMember.tmdbId} className='flex w-26 flex-none flex-col gap-1.75'>
                            <div
                                className='border-border bg-raised aspect-square overflow-hidden rounded-full border'
                                style={photo ? undefined : HATCH_STYLE}
                            >
                                {photo && (
                                    <img src={photo} alt='' className='h-full w-full object-cover' loading='lazy' />
                                )}
                            </div>
                            <span className='text-text text-[13px] leading-tight font-semibold'>{castMember.name}</span>
                            {castMember.character && (
                                <span className='text-muted text-xs leading-tight'>{castMember.character}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function DesktopSkeleton() {
    return (
        <div className='grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-10 overflow-y-auto p-8'>
            <div className='bg-raised aspect-2/3 animate-pulse rounded-sm' />
            <div className='flex flex-col gap-4'>
                <div className='bg-raised h-10 w-2/3 animate-pulse rounded-sm' />
                <div className='bg-raised h-4 w-1/3 animate-pulse rounded-sm' />
                <div className='bg-raised h-24 w-full animate-pulse rounded-sm' />
            </div>
        </div>
    );
}

function MobileSkeleton() {
    return (
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'>
            <div className='flex gap-3.5'>
                <div className='bg-raised aspect-2/3 w-29.5 flex-none animate-pulse rounded-sm' />
                <div className='flex flex-1 flex-col gap-2 pt-1'>
                    <div className='bg-raised h-7 w-4/5 animate-pulse rounded-sm' />
                    <div className='bg-raised h-3 w-1/2 animate-pulse rounded-sm' />
                </div>
            </div>
            <div className='bg-raised h-20 w-full animate-pulse rounded-sm' />
        </div>
    );
}

// Formats an ISO date-only string ("1994-07-14") for display. `timeZone:
// 'UTC'` matters here: without it, `new Date('1994-07-14')` (parsed as UTC
// midnight) renders as the day before in any negative-UTC-offset timezone.
function formatReleaseDate(releaseDate: string | null | undefined): string | null {
    if (!releaseDate) {
        return null;
    }
    const date = new Date(releaseDate);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date);
}
