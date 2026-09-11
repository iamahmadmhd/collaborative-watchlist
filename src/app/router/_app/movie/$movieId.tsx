import { createFileRoute } from '@tanstack/react-router';
import { MovieDetailPage } from '../../../../pages/movie-detail/movie-detail-page';
import { AppShell } from '../../../layouts/app-shell';

// The sidebar stays on "Discover" whether the member arrived from Discovery or
// Search — there is no third nav section for movie detail.
export const Route = createFileRoute('/_app/movie/$movieId')({
    component: RouteComponent,
});

function RouteComponent() {
    const { movieId } = Route.useParams();

    return (
        <AppShell active='Discover'>
            <MovieDetailPage movieId={movieId} />
        </AppShell>
    );
}
