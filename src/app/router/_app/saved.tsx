import { createFileRoute } from '@tanstack/react-router';
import { SavedPage } from '../../../pages/saved/saved-page';
import { AppShell } from '../../layouts/app-shell';

// No search params: sort order is fixed by the byUserAndDate index.
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
