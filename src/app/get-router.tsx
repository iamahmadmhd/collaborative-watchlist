import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { RouteErrorFallback, RouteNotFoundFallback } from './route-fallbacks';

export function getRouter() {
    const router = createTanStackRouter({
        routeTree,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
        defaultErrorComponent: RouteErrorFallback,
        defaultNotFoundComponent: RouteNotFoundFallback,
    });

    return router;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
