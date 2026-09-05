import { Button } from '@/shared/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { signOut } from 'aws-amplify/auth';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
    return (
        <div className='p-8'>
            <h1 className='text-4xl font-bold'>Welcome to Repertory</h1>
            <Button
                onClick={() => {
                    signOut();
                }}
            >
                Sign out
            </Button>
        </div>
    );
}
