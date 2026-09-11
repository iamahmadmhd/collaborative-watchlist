import { useNavigate } from '@tanstack/react-router';
import { ClaimUsernameForm } from '../../features/claim-username/ui/claim-username-form';
import { AuthPageShell } from './auth-page-shell';

// Reached only once verification succeeds for a new member, so a session already
// exists — which is what makes the live availability check an authenticated read
// rather than the anonymous query this app does not permit.
//
// The claim and availability-check logic lives in features/claim-username, shared with
// Settings' recovery path; this page supplies only the onboarding chrome.
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
