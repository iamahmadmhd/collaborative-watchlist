import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../../pages/settings/settings-page';
import { AppShell } from '../../layouts/app-shell';

// FR-AUTH-5/6, FR-THEME-1..6, ADR-011's Settings recovery path. Same thin
// route-composes-a-page pattern as discover.tsx/saved.tsx — no logic here.
export const Route = createFileRoute('/_app/settings')({
    component: RouteComponent,
});

function RouteComponent() {
    return (
        <AppShell active='Settings'>
            <SettingsPage />
        </AppShell>
    );
}
