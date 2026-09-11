import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';

// Shared prev/next pager, extracted from discover-page.tsx and search-page.tsx
// (both drove an identical pair of buttons off a TMDB-paginated query). `info`
// is a caller-supplied slot rather than a fixed "page X / Y" label so each
// screen keeps its own copy (discover adds a result count, search doesn't) and
// its own position in the row (`infoPosition`) rather than forcing one layout.
export function PaginationControls({
    page,
    totalPages,
    onPageChange,
    info,
    infoPosition = 'center',
    className,
}: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    info?: ReactNode;
    infoPosition?: 'start' | 'center';
    className?: string;
}) {
    return (
        <div className={`text-muted flex items-center gap-3 font-mono text-[11px] ${className ?? ''}`}>
            {infoPosition === 'start' && info}
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
            {infoPosition === 'center' && info}
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
