// Cognito error `.name` values are stable identifiers (e.g. UsernameExistsException) —
// mapped to member-facing copy where a friendlier message helps; everything else
// falls back to Cognito's own message rather than swallowing detail. Shared across
// the auth pages slice since every form hits the same error surface.
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
