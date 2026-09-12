import { createFileRoute, Outlet } from '@tanstack/react-router';

// Groups the auth forms under one pathless parent, which is what lets `_app/route.tsx`
// guard everything else. No shared chrome lives here — each page wraps itself in
// AuthPageShell — so this route exists purely for that grouping.
export const Route = createFileRoute('/_auth')({
    component: () => <Outlet />,
});
