// Cognito error `.name` values are stable identifiers, mapped here to member-facing
// copy. Anything unmapped falls back to Cognito's own message rather than swallowing
// the detail.
export function authErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        switch (err.name) {
            case 'UsernameExistsException':
                return 'An account with this email already exists.';
            case 'NotAuthorizedException':
                return 'That code is incorrect or has expired.';
            case 'UserNotFoundException':
                return 'No account found for that email.';
            case 'UserNotConfirmedException':
                return 'Finish creating your account first — check your email for a code, or sign up again.';
            case 'CodeMismatchException':
                return 'That code is incorrect.';
            case 'ExpiredCodeException':
                return 'That code has expired — request a new one.';
            case 'LimitExceededException':
                return 'Too many attempts. Try again in a few minutes.';
            default:
                return err.message || 'Something went wrong. Please try again.';
        }
    }
    return 'Something went wrong. Please try again.';
}
