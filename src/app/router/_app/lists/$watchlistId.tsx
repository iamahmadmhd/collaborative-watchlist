import { createFileRoute } from '@tanstack/react-router';
import { WatchlistDetailPage } from '../../../../pages/watchlist-detail/watchlist-detail-page';
import { AppShell } from '../../../layouts/app-shell';

// The only subscription site in the app — see System Design §2.4.
export const Route = createFileRoute('/_app/lists/$watchlistId')({
    component: RouteComponent,
});

function RouteComponent() {
    const { watchlistId } = Route.useParams();

    return (
        <AppShell active='Watchlists'>
            <WatchlistDetailPage watchlistId={watchlistId} />
        </AppShell>
    );
}
