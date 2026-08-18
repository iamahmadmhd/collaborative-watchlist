import { createFileRoute, Outlet } from '@tanstack/react-router';

// Groups the five auth forms (System Design §2.5) under one pathless parent so the
// future route guard (deferred — providers/routing pass) has a single place to
// distinguish "auth group" from every other route (CLAUDE.md: the auth screens are
// the only unauthenticated surface). No shared chrome lives here yet — each page
// wraps itself in AuthPageShell — this route exists purely for that grouping.
export const Route = createFileRoute('/_auth')({
    component: () => <Outlet />,
});
