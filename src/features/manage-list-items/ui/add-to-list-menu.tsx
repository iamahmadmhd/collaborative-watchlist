import { useState } from 'react';
import { useWatchlists } from '../../../entities/watchlist/api/use-watchlists';
import { canEditWatchlist } from '../../../entities/watchlist/model/watchlist';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import { MenuCheckboxItem, MenuPopup, MenuRoot, MenuTrigger } from '../../../shared/ui/menu';
import { Button } from '../../../shared/ui/button';
import { useIsMovieInWatchlist, useToggleListItem } from '../api/manage-list-items';

// docs/design/Movie Detail.dc.html's "Add to watchlist ▼" control
// (movie-detail-page.tsx previously deferred it: "needs a Watchlists feature
// that doesn't exist yet"). FR-ITEM-1/FR-ITEM-7: only OWNER/EDITOR lists are
// offered — a VIEWER-role list is filtered out client-side here, which is
// presentational only (CLAUDE.md) — the actual enforcement is
// WatchlistItem's ownersDefinedIn authorization rejecting the create/delete
// server-side regardless of what this menu shows.
export function AddToListMenu({ movie }: { movie: MovieSummary }) {
    const [open, setOpen] = useState(false);
    const { data: watchlists, isPending, isError } = useWatchlists();
    const editableLists = watchlists?.filter((watchlist) => canEditWatchlist(watchlist.role)) ?? [];

    return (
        <MenuRoot open={open} onOpenChange={setOpen}>
            <MenuTrigger render={<Button variant='secondary'>Add to watchlist</Button>} />
            <MenuPopup>
                {isPending && <div className='text-muted px-3 py-2 text-sm'>Loading your lists…</div>}
                {isError && <div className='text-danger px-3 py-2 text-sm'>Could not load your watchlists.</div>}
                {!isPending && !isError && editableLists.length === 0 && (
                    <div className='text-muted max-w-64 px-3 py-2 text-sm'>
                        You don&apos;t have an editable watchlist yet — create one from the Watchlists page.
                    </div>
                )}
                {editableLists.map((watchlist) => (
                    <AddToListMenuRow
                        key={watchlist.id}
                        watchlistId={watchlist.id}
                        name={watchlist.name}
                        movie={movie}
                        open={open}
                    />
                ))}
            </MenuPopup>
        </MenuRoot>
    );
}

function AddToListMenuRow({
    watchlistId,
    name,
    movie,
    open,
}: {
    watchlistId: string;
    name: string;
    movie: MovieSummary;
    open: boolean;
}) {
    // Deferred until the menu is actually open (the `enabled` arg) — otherwise
    // every Movie Detail view would fire one point read per editable
    // watchlist just to render a trigger button. useToggleListItem's onMutate
    // writes the optimistic flip into this exact query's cache entry
    // (membershipQueryKey), so `isMember` already reflects it while pending —
    // no separate pending-state inversion needed here.
    const { data: isMember } = useIsMovieInWatchlist(watchlistId, movie.tmdbId, open);
    const toggleListItem = useToggleListItem(watchlistId);

    return (
        <MenuCheckboxItem
            checked={isMember ?? false}
            disabled={isMember === undefined}
            onCheckedChange={() => toggleListItem.mutate({ movie, isMember: isMember ?? false })}
        >
            {name}
        </MenuCheckboxItem>
    );
}
