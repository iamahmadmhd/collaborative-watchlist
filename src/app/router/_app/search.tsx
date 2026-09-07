import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SearchPage } from '../../../pages/search/search-page';
import { AppShell } from '../../layouts/app-shell';

// FR-DISC-2/5. `.catch()` on both fields, matching discover-search.ts's
// recovery style — a hand-edited or stale URL falls back to an empty search
// rather than a route error.
const searchSchema = z.object({
    q: z.string().catch(''),
    page: z.coerce.number().int().min(1).catch(1),
});

export const Route = createFileRoute('/_app/search')({
    validateSearch: searchSchema,
    component: RouteComponent,
});

function RouteComponent() {
    const { q, page } = Route.useSearch();
    const navigate = Route.useNavigate();

    return (
        <AppShell active='Discover'>
            <SearchPage
                query={q}
                page={page}
                onQueryChange={(nextQuery) =>
                    navigate({ search: (prev) => ({ ...prev, q: nextQuery, page: 1 }), replace: true })
                }
                onPageChange={(nextPage) => navigate({ search: (prev) => ({ ...prev, page: nextPage }) })}
            />
        </AppShell>
    );
}
