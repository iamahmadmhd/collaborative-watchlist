import type { ReactNode } from 'react';
import { ShellSidebar, type ShellSection } from './shell-sidebar';
import { TabBar } from './tab-bar';

// Wraps a page in the desktop sidebar rail and the mobile tab bar. Both render
// always; the `lg:` breakpoint decides which is visible.
//
// `h-svh overflow-hidden` (not `min-h-svh`) is load-bearing: it caps this root at the
// viewport height so only a page's own `flex-1 overflow-y-auto` region scrolls. A
// floor alone would let tall content grow the container and scroll the nav away with
// it. `min-h-0` on the content column is the matching fix on the other axis — a flex
// item's default `min-height: auto` refuses to shrink below its content, which
// silently defeats a descendant's `overflow-y-auto`.
export function AppShell({ active, children }: { active: ShellSection; children: ReactNode }) {
    return (
        <div className='bg-surface flex h-svh flex-col overflow-hidden lg:flex-row'>
            <ShellSidebar active={active} className='hidden lg:flex' />
            <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
            <TabBar active={active} className='lg:hidden' />
        </div>
    );
}
