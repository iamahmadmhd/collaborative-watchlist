import { createFileRoute, redirect } from '@tanstack/react-router';

// No dedicated "home" screen exists in the design (docs/design) — Discovery is
// the landing screen for a signed-in member (its own doc: "01 Discovery").
// Guarded by the parent `_app` route's beforeLoad; nothing else to check here.
export const Route = createFileRoute('/_app/')({
    beforeLoad: () => {
        throw redirect({ to: '/discover', search: { page: 1 } });
    },
});
