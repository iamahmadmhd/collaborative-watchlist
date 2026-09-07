import { createFileRoute } from '@tanstack/react-router';
import { discoverSearchSchema } from '../../../features/filter-discovery/model/discover-search';
import { DiscoverPage } from '../../../pages/discover/discover-page';
import { AppShell } from '../../layouts/app-shell';

// FR-DISC-1/3/5. Route files compose pages and configure them (CLAUDE.md) —
// AppShell wraps here, not inside the page component, because `app/layouts` is
// app-layer and pages may not import upward from it (eslint-plugin-boundaries).
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
