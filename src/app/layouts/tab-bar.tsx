import { Link } from '@tanstack/react-router';
import type { ShellSection } from './shell-sidebar';
import { BookmarkIcon, CogIcon, MagnifyingGlassIcon, QueueListIcon } from '@heroicons/react/24/solid';

// Reuses ShellSidebar's section type so both nav pieces agree on the same four
// destinations and AppShell can pass one `active` value to each.
export type TabSection = ShellSection;

const TABS: { label: string; section: TabSection; to: string; icon: typeof MagnifyingGlassIcon }[] = [
    { label: 'DISCOVER', section: 'Discover', to: '/discover', icon: MagnifyingGlassIcon },
    { label: 'SAVED', section: 'Saved', to: '/saved', icon: BookmarkIcon },
    { label: 'LISTS', section: 'Watchlists', to: '/lists', icon: QueueListIcon },
    { label: 'Settings', section: 'Settings', to: '/settings', icon: CogIcon },
];

// Mobile-only bottom nav.
export function TabBar({ active, className }: { active: TabSection; className?: string }) {
    return (
        <nav className={`border-border bg-raised flex flex-none border-t pt-2.25 pb-6 ${className ?? ''}`}>
            {TABS.map((tab) => {
                const isActive = tab.section === active;
                const content = (
                    <>
                        <tab.icon className={`size-6 ${isActive ? 'text-accent' : 'text-muted'}`} />
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
