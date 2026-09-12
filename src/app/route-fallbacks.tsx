import { Link } from '@tanstack/react-router';

// Router-level fallbacks, wired in get-router.tsx. Without them an uncaught render
// error — including a search-param validation failure — leaves a blank document.
//
// Deliberately dependency-free: these mount in the eager auth-shell chunk, so they use
// token classes directly rather than pulling shared/ui in behind them.
const shell = 'bg-surface flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center';

export function RouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
    return (
        <div className={shell}>
            <h1 className='font-display text-text m-0 text-2xl font-bold tracking-tight'>Something went wrong</h1>
            <p role='alert' className='font-body text-muted max-w-100 text-sm'>
                {error.message || 'This screen could not be displayed.'}
            </p>
            <div className='flex items-center gap-3'>
                <button
                    type='button'
                    onClick={reset}
                    className='bg-accent text-accent-contrast font-body h-10.5 rounded-[3px] px-4 text-sm font-semibold'
                >
                    Try again
                </button>
                <Link
                    to='/'
                    className='border-border text-text font-body flex h-10.5 items-center rounded-[3px] border px-4 text-sm font-semibold'
                >
                    Go home
                </Link>
            </div>
        </div>
    );
}

export function RouteNotFoundFallback() {
    return (
        <div className={shell}>
            <span className='text-muted font-mono text-[11px] tracking-[0.08em]'>404</span>
            <h1 className='font-display text-text m-0 text-2xl font-bold tracking-tight'>Page not found</h1>
            <Link
                to='/'
                className='border-border text-text font-body flex h-10.5 items-center rounded-[3px] border px-4 text-sm font-semibold'
            >
                Go home
            </Link>
        </div>
    );
}
