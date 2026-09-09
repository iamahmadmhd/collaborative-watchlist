import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useCurrentUser } from '../../entities/member/api/use-current-user';
import { useCurrentUserEmail } from '../../entities/member/api/use-current-user-email';
import { ClaimUsernameForm } from '../../features/claim-username/ui/claim-username-form';
import { EditProfileForm } from '../../features/edit-profile/ui/edit-profile-form';
import { useSignOut } from '../../features/sign-out/api/sign-out';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { Button } from '../../shared/ui/button';
import { DialogClose, DialogPopup, DialogRoot, DialogTrigger } from '../../shared/ui/dialog';
import { queryClient } from '../../shared/lib/query-client';
import { CURRENT_USER_QUERY_KEY } from '../../entities/member/api/use-current-user';

// docs/design/Settings.dc.html. No FR-LIST/FR-ITEM equivalent for this screen's own
// existence — it's the aggregate home for FR-AUTH-5/6, FR-THEME-1..6, and ADR-011's
// Settings recovery path, none of which had anywhere to live before this page did
// (CLAUDE.md's module structure lists `pages/settings/`; nothing implemented it).
//
// Two rows the board shows are deliberately NOT built here — flagging per this
// project's own "don't silently resolve a board/spec conflict" rule (docs/design/README.md):
//   - Email "Change": no FR anywhere authorizes changing the sign-in email this
//     release (FR-AUTH lists registration, verification, sign-out, username, display
//     name/avatar — never email change). Building it would be inventing scope.
//   - "Delete account" (NFR-COMP-2): the board's own hint ("Films you added to shared
//     lists stay, without your name") implies an anonymization semantic NFR-COMP-2
//     doesn't actually specify, cascading deletion needs a new Lambda (Cognito user
//     deletion + UserProfile/Username/SavedMovie/WatchStatus/owned-Watchlist cleanup)
//     that doesn't exist yet, and what happens to `WatchlistItem.addedBy` pointing at
//     a deleted user on lists that member doesn't own is an undecided data-model
//     question, not an implementation detail. Exactly the kind of gap CLAUDE.md says
//     to stop and ask about rather than build silently.
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
    if (!joinedAt) return null;
    const date = new Date(joinedAt);
    if (Number.isNaN(date.getTime())) return null;
    return `joined ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)}`;
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
        <section id='appearance' className='flex flex-col gap-3'>
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
        <section
            id='identity'
            className='border-border flex flex-col gap-4 border-t pt-5.5 first:border-t-0 first:pt-0'
        >
            <SectionHeading>Public identity</SectionHeading>
            {user?.username ? (
                <div className='flex flex-col gap-1.5'>
                    <span className='text-text text-[15px] font-semibold'>Username</span>
                    <span className='text-muted font-mono text-sm'>@{user.username}</span>
                    <span className='font-body text-muted text-xs'>Usernames can&apos;t be changed once claimed.</span>
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
        <section id='account' className='border-border flex flex-col gap-4 border-t pt-5.5'>
            <SectionHeading>Account</SectionHeading>
            <SignOutRow />
        </section>
    );
}

function SignOutRow() {
    const navigate = useNavigate();
    const signOut = useSignOut();
    const [confirmOpen, setConfirmOpen] = useState(false);

    async function handleSignOut() {
        await signOut.mutateAsync(false);
        await navigate({ to: '/get-started' });
    }

    async function handleSignOutEverywhere() {
        await signOut.mutateAsync(true);
        setConfirmOpen(false);
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
                <DialogRoot open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogTrigger
                        render={
                            <button
                                type='button'
                                className='text-danger font-mono text-[11px] tracking-[0.04em] uppercase'
                            >
                                Sign out everywhere
                            </button>
                        }
                    />
                    <DialogPopup
                        title='Sign out everywhere?'
                        description="You'll be signed out on every device, including this one, and need a fresh code to sign back in."
                    >
                        <div className='flex justify-end gap-3'>
                            <DialogClose
                                render={
                                    <Button variant='secondary' type='button'>
                                        Cancel
                                    </Button>
                                }
                            />
                            <Button type='button' isLoading={signOut.isPending} onClick={handleSignOutEverywhere}>
                                Sign out everywhere
                            </Button>
                        </div>
                    </DialogPopup>
                </DialogRoot>
            </div>
        </div>
    );
}
