import { createFileRoute } from '@tanstack/react-router';
import { WatchlistsPage } from '../../../../pages/watchlists/watchlists-page';
import { AppShell } from '../../../layouts/app-shell';

// FR-LIST-5. Route path is /lists, not /watchlists — matches System Design §5.2's
// access-pattern table and §2.4's "/lists/:id" naming (the pages/ slice itself is
// named `watchlists`, an FSD noun; movie-detail's own route already establishes
// this project's route-path-vs-page-slice-name split, at /movie/$movieId). Nested
// under a `lists/` folder rather than a flat `lists.tsx` file so watchlist-detail's
// future /lists/$watchlistId route has a natural sibling home, mirroring
// movie/$movieId.tsx's own directory shape.
export const Route = createFileRoute('/_app/lists/')({
    component: RouteComponent,
});

function RouteComponent() {
    return (
        <AppShell active='Watchlists'>
            <WatchlistsPage />
        </AppShell>
    );
}
