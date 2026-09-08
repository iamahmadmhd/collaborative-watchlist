import { useNavigate } from '@tanstack/react-router';
import { ClaimUsernameForm } from '../../features/claim-username/ui/claim-username-form';
import { AuthPageShell } from './auth-page-shell';

// FR-AUTH-3/4/5, ADR-011 (v1.4). Reached only once email verification succeeds
// for a new member (verify.tsx navigates here on mode 'signup') — the session
// already exists by this point (autoSignIn ran in verify.tsx), which is what
// makes the live availability check inside ClaimUsernameForm safe to build
// server-side: it's an authenticated read against the Username sentinel model,
// not the anonymous query ADR-009/V-10 forbid pre-verification.
//
// The claim + availability-check logic itself lives in
// features/claim-username (a shared FSD slice, per ADR-011's note that
// Settings will call the same claimUsername mutation as a recovery path) —
// this page only supplies the onboarding-specific chrome around it.
//
// redirect?: string | undefined — see the matching note in sign-up.tsx.
export function UsernamePage({ redirect }: { redirect?: string | undefined }) {
    const navigate = useNavigate();

    return (
        <AuthPageShell
            title='Pick a username'
            subtitle='Friends add you to lists by username, and it labels every film you add.'
        >
            <div className='text-muted flex items-center gap-2 font-mono text-[10px] tracking-[0.08em]'>
                <span className='text-ok'>EMAIL VERIFIED</span>
                <span className='bg-border h-px flex-1' />
                <span className='text-text'>LAST STEP</span>
            </div>
            <ClaimUsernameForm
                submitLabel='Finish setting up'
                onSuccess={() => void navigate({ to: redirect ?? '/' })}
            />
            <p className='font-body text-muted text-xs leading-relaxed'>
                Your username and display name are visible to anyone you share a list with.
            </p>
        </AuthPageShell>
    );
}
