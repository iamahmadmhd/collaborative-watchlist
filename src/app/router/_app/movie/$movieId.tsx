import { createFileRoute } from '@tanstack/react-router';
import { MovieDetailPage } from '../../../../pages/movie-detail/movie-detail-page';
import { AppShell } from '../../../layouts/app-shell';

// FR-DISC-4. `$movieId.tsx` is the framework-contract filename CLAUDE.md's
// Naming section already names for this route — TanStack Router's file-based
// routing assigns it meaning, so it lives in its own `movie/` folder rather
// than a flat `movie.$movieId.tsx` (both work; the folder form is what
// CLAUDE.md's example names). Shell Sidebar stays on "Discover" regardless of
// whether the member arrived via Discovery or Search (docs/design/Movie
// Detail.dc.html) — there's no third nav section for it.
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
