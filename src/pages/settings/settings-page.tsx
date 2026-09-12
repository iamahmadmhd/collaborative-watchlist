import { useNavigate } from '@tanstack/react-router';
import { useCurrentUser } from '../../entities/member/api/use-current-user';
import { useCurrentUserEmail } from '../../entities/member/api/use-current-user-email';
import { ClaimUsernameForm } from '../../features/claim-username/ui/claim-username-form';
import { EditProfileForm } from '../../features/edit-profile/ui/edit-profile-form';
import { useSignOut } from '../../features/sign-out/api/sign-out';
import { useDeleteAccount } from '../../features/delete-account/api/delete-account';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { queryClient } from '../../shared/lib/query-client';
import { CURRENT_USER_QUERY_KEY } from '../../entities/member/api/use-current-user';
import { formatIsoDate } from '../../shared/lib/format-date';

// The aggregate home for profile editing, sign-out, theme, the username recovery path
// and account deletion.
export function SettingsPage() {
    const currentUserQuery = useCurrentUser();

    return (
        <>
            {/* Desktop */}
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col lg:flex'>
                <Header joinedAt={currentUserQuery.data?.joinedAt} />
                <div className='min-h-0 flex-1 overflow-y-auto px-7 py-5.5'>
                    <div className='flex flex-col gap-5.5'>
                        <AppearanceSection variant='cards' />
                        <IdentitySection />
                        <AccountSection />
                    </div>
                </div>
            </div>

            {/* Mobile */}
            <div className='flex min-h-0 flex-1 flex-col lg:hidden'>
                <MobileHeader />
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                    <div className='flex flex-col gap-5.5'>
                        <AppearanceSection variant='segment' />
                        <IdentitySection />
                        <AccountSection />
                    </div>
                </div>
            </div>
        </>
    );
}

function formatJoinedDate(joinedAt: string | null | undefined): string | null {
    const formatted = formatIsoDate(joinedAt, { month: 'long', year: 'numeric' });
    return formatted ? `joined ${formatted}` : null;
}

function Header({ joinedAt }: { joinedAt: string | null | undefined }) {
    const emailQuery = useCurrentUserEmail();
    const joined = formatJoinedDate(joinedAt);
    const subtitle = [emailQuery.data, joined].filter(Boolean).join(' · ');

    return (
        <header className='border-border bg-raised flex flex-none flex-col gap-1.5 border-b px-7 py-5.5'>
            <h1 className='font-display text-text m-0 text-[30px] font-bold tracking-tight'>Settings</h1>
            {subtitle && <span className='text-muted font-mono text-[11px]'>{subtitle}</span>}
        </header>
    );
}

function MobileHeader() {
    const emailQuery = useCurrentUserEmail();

    return (
        <div className='border-border bg-raised flex flex-none flex-col gap-1 px-4 pt-11 pb-3'>
            <h1 className='font-display text-text m-0 text-[24px] font-bold tracking-[-0.02em]'>Settings</h1>
            {emailQuery.data && <span className='text-muted font-mono text-[10px]'>{emailQuery.data}</span>}
        </div>
    );
}

function SectionHeading({ children }: { children: string }) {
    return <span className='text-muted font-mono text-[10px] tracking-[0.08em] uppercase'>{children}</span>;
}

function AppearanceSection({ variant }: { variant: 'cards' | 'segment' }) {
    return (
        <section className='flex flex-col gap-3'>
            <SectionHeading>Appearance</SectionHeading>
            <div className='flex flex-col gap-0.5'>
                <span className='text-text text-[15px] font-semibold'>Theme</span>
                <span className='text-muted font-body text-[13px]'>
                    Choose how Repertory looks. System follows your device.
                </span>
            </div>
            <ThemeToggle variant={variant} />
        </section>
    );
}

function IdentitySection() {
    const currentUserQuery = useCurrentUser();
    const user = currentUserQuery.data;

    return (
        <section className='border-border flex flex-col gap-4 border-t pt-5.5 first:border-t-0 first:pt-0'>
            <SectionHeading>Public identity</SectionHeading>
            {user?.username ? (
                <div className='flex flex-col gap-1.5'>
                    <span className='text-text text-[15px] font-semibold'>Username</span>
                    <span className='text-muted font-mono text-sm'>@{user.username}</span>
                </div>
            ) : currentUserQuery.isSuccess ? (
                <div className='flex flex-col gap-1.5'>
                    <span className='text-text text-[15px] font-semibold'>Claim your username</span>
                    <span className='font-body text-muted text-xs'>
                        You verified your email but never finished picking a username — you&apos;ll need one before
                        anyone can add you to a watchlist.
                    </span>
                    <ClaimUsernameForm
                        submitLabel='Claim username'
                        onSuccess={() => void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY })}
                    />
                </div>
            ) : null}
            <EditProfileForm currentDisplayName={user?.displayName ?? null} />
        </section>
    );
}

function AccountSection() {
    return (
        <section className='border-border flex flex-col gap-4 border-t pt-5.5'>
            <SectionHeading>Account</SectionHeading>
            <SignOutRow />
            <DeleteAccountRow />
        </section>
    );
}

function SignOutRow() {
    const navigate = useNavigate();
    const signOut = useSignOut();

    async function handleSignOut() {
        await signOut.mutateAsync(false);
        await navigate({ to: '/get-started' });
    }

    return (
        <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-4'>
                <div className='flex flex-1 flex-col gap-0.5'>
                    <span className='text-text text-sm font-semibold'>Sign out</span>
                    <span className='text-muted font-body text-xs'>End your session on this device.</span>
                </div>
                <Button type='button' variant='secondary' isLoading={signOut.isPending} onClick={handleSignOut}>
                    Sign out
                </Button>
            </div>
            <div className='flex items-center gap-4'>
                <div className='flex flex-1 flex-col gap-0.5'>
                    <span className='text-text text-sm font-semibold'>Sign out everywhere</span>
                    <span className='text-muted font-body text-xs'>
                        End every session, on every device signed in as you.
                    </span>
                </div>
                <ConfirmDialog
                    trigger={
                        <button type='button' className='text-danger font-mono text-[11px] tracking-[0.04em] uppercase'>
                            Sign out everywhere
                        </button>
                    }
                    title='Sign out everywhere?'
                    description="You'll be signed out on every device, including this one, and need a fresh code to sign back in."
                    confirmLabel='Sign out everywhere'
                    onConfirm={async () => {
                        await signOut.mutateAsync(true);
                        await navigate({ to: '/get-started' });
                    }}
                />
            </div>
        </div>
    );
}

// Same confirm-dialog shape as SignOutRow, but this mutation can fail partway through
// seven tables, so the dialog stays open with the error shown. Retrying is just
// submitting again — every backend step is idempotent.
function DeleteAccountRow() {
    const navigate = useNavigate();
    const deleteAccount = useDeleteAccount();

    return (
        <div className='flex items-center gap-4'>
            <div className='flex flex-1 flex-col gap-0.5'>
                <span className='text-text text-sm font-semibold'>Delete account</span>
                <span className='text-muted font-body text-xs'>
                    Permanently remove your profile, saved films, watched records, and any watchlists you own. This
                    can&apos;t be undone.
                </span>
            </div>
            <ConfirmDialog
                trigger={
                    <button type='button' className='text-danger font-mono text-[11px] tracking-[0.04em] uppercase'>
                        Delete account
                    </button>
                }
                title='Delete your account?'
                description="This permanently deletes your profile, saved films, and watched records. Any watchlist you own is deleted for every collaborator on it — lists you've joined but don't own, you'll simply leave. This can't be undone."
                confirmLabel='Delete account'
                fallbackErrorMessage='Could not delete your account. Please try again.'
                onConfirm={async () => {
                    await deleteAccount.mutateAsync();
                    await navigate({ to: '/get-started' });
                }}
            />
        </div>
    );
}
