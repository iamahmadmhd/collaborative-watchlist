import type { ReactNode } from 'react';
import { ShellSidebar, type ShellSection } from './shell-sidebar';
import { TabBar } from './tab-bar';

// Composes the two shared nav chrome pieces from docs/design (Shell Sidebar
// desktop rail, Tab Bar mobile bottom nav) around a page's own content. Both
// DOM trees render always; Tailwind's `lg:` breakpoint toggles which is
// visible (auth-page-shell.tsx's established pattern in this codebase), rather
// than a `mode` prop deciding it — that was the design tool's preview-frame
// mechanism, not a production responsive strategy. System Design module
// structure: this belongs in app/layouts, not a `widgets` layer this project
// deliberately doesn't have (CLAUDE.md) — it has exactly one caller shape (the
// authenticated app shell), not a library of cross-page composites.
//
// `h-svh overflow-hidden` (not `min-h-svh`) is load-bearing, not decorative:
// it caps this root at exactly the viewport height so the sidebar/tab-bar
// never move and only a page's own `flex-1 overflow-y-auto` region scrolls.
// `min-h-svh` only sets a floor — with no ceiling, page content taller than
// the viewport grows this container (and the whole document) instead, which
// is what made the sidebar/header/tab-bar scroll away with everything else.
// `min-h-0` on the content column is the matching fix on the other axis: a
// flex item's default `min-height: auto` refuses to shrink below its
// content's height, which silently defeats a descendant's `overflow-y-auto`
// even when this root is correctly bounded.
export function AppShell({ active, children }: { active: ShellSection; children: ReactNode }) {
    return (
        <div className='bg-surface flex h-svh flex-col overflow-hidden lg:flex-row'>
            <ShellSidebar active={active} className='hidden lg:flex' />
            <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
            <TabBar active={active} className='lg:hidden' />
        </div>
    );
}
