import { createFileRoute, redirect } from '@tanstack/react-router';

// Discovery is the landing screen for a signed-in member; there is no separate home.
// Guarded by the parent `_app` route's beforeLoad.
export const Route = createFileRoute('/_app/')({
    beforeLoad: () => {
        throw redirect({ to: '/discover', search: { page: 1 } });
    },
});
