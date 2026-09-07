import { createFileRoute } from '@tanstack/react-router';
import { SavedPage } from '../../../pages/saved/saved-page';
import { AppShell } from '../../layouts/app-shell';

// FR-SAVE-3. No search params: sort order is fixed (System Design §5.2 access
// pattern 1, the byUserAndDate index), matching discover.tsx/search.tsx's
// pattern of composing AppShell + a page here rather than in the page itself.
export const Route = createFileRoute('/_app/saved')({
    component: RouteComponent,
});

function RouteComponent() {
    return (
        <AppShell active='Saved'>
            <SavedPage />
        </AppShell>
    );
}
