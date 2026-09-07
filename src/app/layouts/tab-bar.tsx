import { Link } from '@tanstack/react-router';

export type TabSection = 'Discover' | 'Saved' | 'Watchlists' | 'You';

const TABS: { label: string; section: TabSection; to?: string }[] = [
    { label: 'DISCOVER', section: 'Discover', to: '/discover' },
    { label: 'SAVED', section: 'Saved', to: '/saved' },
    { label: 'LISTS', section: 'Watchlists', to: '/lists' },
    // You (Settings) has no page yet — see shell-sidebar.tsx's matching note.
    // Not a `<Link>` until it exists.
    { label: 'YOU', section: 'You' },
];

// docs/design/Tab Bar.dc.html, verbatim — mobile-only bottom nav.
export function TabBar({ active, className }: { active: TabSection; className?: string }) {
    return (
        <nav className={`border-border bg-raised flex flex-none border-t pt-2.25 pb-6 ${className ?? ''}`}>
            {TABS.map((tab) => {
                const isActive = tab.section === active;
                const content = (
                    <>
                        <div className={`h-2.25 w-2.25 rounded-[1px] ${isActive ? 'bg-accent' : 'bg-border'}`} />
                        <span
                            className={`font-mono text-[9px] tracking-[0.06em] ${isActive ? 'text-accent' : 'text-muted'}`}
                        >
                            {tab.label}
                        </span>
                    </>
                );
                const itemClassName = 'flex min-h-11 flex-1 flex-col items-center justify-center gap-1.25';
                return tab.to ? (
                    <Link key={tab.section} to={tab.to} className={itemClassName}>
                        {content}
                    </Link>
                ) : (
                    <div key={tab.section} className={itemClassName}>
                        {content}
                    </div>
                );
            })}
        </nav>
    );
}
