import type { ReactNode } from 'react';

// The isPending/isError/empty branch every list screen repeats. This unifies the
// branching only — callers still supply their own pending fallback, error copy and
// empty state, so a grid skeleton and a row-list skeleton need not look alike.
type BasicQueryState<TData> = {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: TData | undefined;
};

export function QueryState<TData>({
    query,
    pending,
    errorPrefix,
    errorClassName,
    empty,
    isEmpty,
    children,
}: {
    query: BasicQueryState<TData>;
    pending: ReactNode;
    errorPrefix: string;
    errorClassName?: string | undefined;
    empty?: ReactNode;
    isEmpty?: (data: TData) => boolean;
    children: (data: TData) => ReactNode;
}) {
    if (query.isPending) {
        return <>{pending}</>;
    }

    if (query.isError) {
        return (
            <p className={`text-danger font-body text-sm ${errorClassName ?? ''}`} role='alert'>
                {errorPrefix} {query.error instanceof Error ? query.error.message : ''}
            </p>
        );
    }

    if (query.data === undefined) {
        return null;
    }

    if (empty && isEmpty?.(query.data)) {
        return <>{empty}</>;
    }

    return <>{children(query.data)}</>;
}
