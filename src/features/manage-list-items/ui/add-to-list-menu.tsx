import { useState } from 'react';
import { useWatchlists } from '../../../entities/watchlist/api/use-watchlists';
import { canEditWatchlist } from '../../../entities/watchlist/model/watchlist';
import type { MovieSummary } from '../../../entities/movie/model/movie';
import { MenuCheckboxItem, MenuPopup, MenuRoot, MenuTrigger } from '../../../shared/ui/menu';
import { Button } from '../../../shared/ui/button';
import { useIsMovieInWatchlist, useToggleListItem } from '../api/manage-list-items';

// Only Owner/Editor lists are offered; a Viewer-role list is filtered out here. That
// filtering is presentational — WatchlistItem's authorization rejects the write
// server-side regardless of what this menu shows.
export function AddToListMenu({ movie }: { movie: MovieSummary }) {
    const [open, setOpen] = useState(false);
    const { data: watchlists, isPending, isError } = useWatchlists();

    const editableLists = watchlists?.filter((watchlist) => canEditWatchlist(watchlist.role)) ?? [];
    const isEmpty = !isPending && !isError && editableLists.length === 0;

    return (
        <MenuRoot open={open} onOpenChange={setOpen}>
            <MenuTrigger render={<Button variant='secondary'>Add to watchlist</Button>} />
            <MenuPopup>
                {isPending && <div className='text-muted px-3 py-2 text-sm'>Loading your lists…</div>}
                {isError && <div className='text-danger px-3 py-2 text-sm'>Could not load your watchlists.</div>}
                {isEmpty && (
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
    // Deferred until the menu is open, or every Movie Detail view would fire one point
    // read per editable watchlist just to render a trigger. useToggleListItem's onMutate
    // writes into this same cache entry, so `isMember` already reflects a pending flip.
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
