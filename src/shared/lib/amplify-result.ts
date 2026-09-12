// A GraphQL response carries `errors` alongside `data`; an operation that failed still
// resolves, with `data` empty rather than absent. These two helpers are what keep a
// failure from reading as "nothing there".
type ResponseError = { message?: string | undefined };

type ListPage<TItem> = {
    data: TItem[];
    nextToken?: string | null | undefined;
    errors?: ResponseError[] | undefined;
};

export function throwOnErrors(errors: ResponseError[] | null | undefined, fallbackMessage: string): void {
    if (errors?.length) {
        throw new Error(errors[0]?.message || fallbackMessage);
    }
}

// Amplify returns one service page per call. Draining `nextToken` is what stops a list
// from silently truncating once it outgrows that page.
export async function listAll<TItem>(
    fetchPage: (nextToken: string | null) => Promise<ListPage<TItem>>,
    fallbackMessage: string,
): Promise<TItem[]> {
    const items: TItem[] = [];
    let nextToken: string | null = null;

    do {
        const page = await fetchPage(nextToken);
        throwOnErrors(page.errors, fallbackMessage);
        items.push(...page.data);
        nextToken = page.nextToken ?? null;
    } while (nextToken !== null);

    return items;
}
