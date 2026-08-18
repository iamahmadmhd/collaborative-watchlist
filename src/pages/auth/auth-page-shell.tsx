import type { ReactNode } from 'react';

// Design System §3, docs/design/Auth.dc.html (v1.2). Desktop: two-column split —
// pitch copy + a sample attribution-stripe list on the left (raised background,
// border-right), the form centered on the right. Mobile: single column, form only.
// The pitch panel is shared chrome across sign-up (which also handles returning
// members — System Design §2.5, ADR-010) and verify, matching the board (present
// outside its isSignup/isVerify conditional there).
//
// Deliberately NOT a pixel-for-pixel transcription of every inline style in the
// board — this is a faithful adaptation (fonts, tokens, radii, spacing scale,
// structure), not a literal copy. Screen-level layout beyond auth remains an open
// item (CLAUDE.md, System Design §10).

const SAMPLE_ITEMS: { title: string; year: string; by: string; colorVar: string }[] = [
    { title: 'Chungking Express', year: '1994', by: '@ada', colorVar: 'var(--m1)' },
    { title: 'Cléo from 5 to 7', year: '1962', by: '@renzo', colorVar: 'var(--m2)' },
    { title: 'Yi Yi', year: '2000', by: '@ivy', colorVar: 'var(--m3)' },
    { title: 'Wanda', year: '1970', by: '@kofi', colorVar: 'var(--m4)' },
];

function PitchPanel() {
    return (
        <div className='border-border bg-raised hidden flex-col justify-between overflow-hidden border-r p-14 lg:flex'>
            <div className='flex items-baseline gap-2'>
                <span className='font-display text-text text-xl font-bold tracking-[-0.02em]'>Repertory</span>
            </div>
            <div className='flex max-w-110 flex-col gap-5'>
                <h1 className='font-display text-text m-0 text-4xl leading-[1.06] font-bold tracking-[-0.03em]'>
                    Keep a watchlist with the people you actually watch films with.
                </h1>
                <p className='text-muted m-0 text-base leading-relaxed'>
                    Every film in a shared list carries a stripe in the colour of whoever added it. No requests, no
                    approvals — add a collaborator by handle and they can start programming.
                </p>
                <div className='border-border flex flex-col gap-2.5 border-t pt-5'>
                    {SAMPLE_ITEMS.map((item) => (
                        <div key={item.title} className='flex items-center gap-3'>
                            <div className='h-5.5 w-1' style={{ background: item.colorVar }} />
                            <span className='font-body text-text text-sm font-semibold'>{item.title}</span>
                            <span className='text-muted font-mono text-[11px]'>{item.year}</span>
                            <span className='text-muted ml-auto font-mono text-[11px]'>{item.by}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className='flex items-center gap-2.5'>
                <span className='border-accent text-accent rounded-xs border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest'>
                    TMDB
                </span>
                <span className='text-muted text-[11px]'>
                    This product uses the TMDB API but is not endorsed or certified by TMDB.
                </span>
            </div>
        </div>
    );
}

export function AuthPageShell({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className='bg-surface grid min-h-svh grid-cols-1 lg:grid-cols-2'>
            <PitchPanel />
            <div className='flex items-center justify-center p-8 lg:p-14'>
                <div className='flex w-full max-w-100 flex-col gap-5'>
                    <div className='flex flex-col gap-1.5'>
                        <h2 className='font-display text-text m-0 text-[27px] leading-[1.1] font-bold tracking-tight'>
                            {title}
                        </h2>
                        {subtitle && <span className='text-muted text-sm'>{subtitle}</span>}
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}
