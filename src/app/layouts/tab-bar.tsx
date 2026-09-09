import { Link } from '@tanstack/react-router';
import type { ShellSection } from './shell-sidebar';

// Reuses ShellSidebar's section type (rather than its own wider union, as before
// Settings existed) — both nav chrome pieces now agree on the same four
// destinations, matching AppShell passing one `active` value to both.
export type TabSection = ShellSection;

const TABS: { label: string; section: TabSection; to: string }[] = [
    { label: 'DISCOVER', section: 'Discover', to: '/discover' },
    { label: 'SAVED', section: 'Saved', to: '/saved' },
    { label: 'LISTS', section: 'Watchlists', to: '/lists' },
    { label: 'YOU', section: 'Settings', to: '/settings' },
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
                return (
                    <Link
                        key={tab.section}
                        to={tab.to}
                        className='flex min-h-11 flex-1 flex-col items-center justify-center gap-1.25'
                    >
                        {content}
                    </Link>
                );
            })}
        </nav>
    );
}
