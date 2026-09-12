import { createFileRoute } from '@tanstack/react-router';
import { WatchlistsPage } from '../../../../pages/watchlists/watchlists-page';
import { AppShell } from '../../../layouts/app-shell';

// The route path is /lists while the page slice is named `watchlists` — the same
// route-path-vs-slice-name split /movie/$movieId already uses.
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
