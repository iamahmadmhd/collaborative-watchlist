import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../../pages/settings/settings-page';
import { AppShell } from '../../layouts/app-shell';

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
