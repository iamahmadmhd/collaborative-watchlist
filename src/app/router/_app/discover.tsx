import { createFileRoute } from '@tanstack/react-router';
import { discoverSearchSchema } from '../../../features/filter-discovery/model/discover-search';
import { DiscoverPage } from '../../../pages/discover/discover-page';
import { AppShell } from '../../layouts/app-shell';

// AppShell wraps here rather than inside the page: `app/layouts` is app-layer, and
// pages may not import upward from it.
export const Route = createFileRoute('/_app/discover')({
    validateSearch: discoverSearchSchema,
    component: RouteComponent,
});

function RouteComponent() {
    const { genreId, page } = Route.useSearch();
    const navigate = Route.useNavigate();

    return (
        <AppShell active='Discover'>
            <DiscoverPage
                genreId={genreId}
                page={page}
                onGenreChange={(nextGenreId) =>
                    navigate({ search: (prev) => ({ ...prev, genreId: nextGenreId, page: 1 }) })
                }
                onPageChange={(nextPage) => navigate({ search: (prev) => ({ ...prev, page: nextPage }) })}
            />
        </AppShell>
    );
}
