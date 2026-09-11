import { ArrowLeftIcon } from '@heroicons/react/24/solid';

// Shared "‹ BACK" chrome: a desktop and mobile header pair differing only in label.
export function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
    return (
        <header className='border-border bg-raised flex flex-none items-center gap-3.5 border-b px-7 py-3.5'>
            <button
                type='button'
                onClick={onBack}
                className='text-muted hover:text-text flex items-center gap-2 font-mono text-[11px] tracking-[0.02em]'
            >
                <ArrowLeftIcon className='size-4' /> {label}
            </button>
        </header>
    );
}

export function MobileBackHeader({ label, onBack }: { label: string; onBack: () => void }) {
    return (
        <div className='border-border bg-raised flex flex-none items-center justify-between px-4 pt-11 pb-2.5'>
            <button type='button' onClick={onBack} className='text-muted flex items-center gap-2 font-mono text-[11px]'>
                <ArrowLeftIcon className='size-4' /> {label}
            </button>
        </div>
    );
}
