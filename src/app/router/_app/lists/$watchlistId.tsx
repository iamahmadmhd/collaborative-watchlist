import { createFileRoute } from '@tanstack/react-router';
import { WatchlistDetailPage } from '../../../../pages/watchlist-detail/watchlist-detail-page';
import { AppShell } from '../../../layouts/app-shell';

// FR-LIST-5's destination, System Design §2.4 ("/lists/:id is the only
// subscription site"). `$watchlistId.tsx` alongside lists/index.tsx mirrors
// movie/$movieId.tsx's own directory shape (CLAUDE.md's router-filename
// exception) — both are framework-contract filenames TanStack Router assigns
// meaning to.
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
