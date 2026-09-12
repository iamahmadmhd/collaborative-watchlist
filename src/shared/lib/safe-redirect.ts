// The post-sign-in return path arrives as a URL search param, so it is attacker-supplied.
// Only a single-slash absolute path is allowed through: "//host" and "/\host" are
// protocol-relative, and anything with a scheme leaves the origin entirely.
export function safeRedirect(redirect: string | null | undefined): string {
    if (!redirect || !redirect.startsWith('/')) {
        return '/';
    }
    if (redirect.startsWith('//') || redirect.startsWith('/\\')) {
        return '/';
    }
    return redirect;
}
