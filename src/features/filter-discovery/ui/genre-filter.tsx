import { useGenres } from '../../../entities/movie/api/use-genres';
import { Select, type SelectItem } from '../../../shared/ui/select';

const ALL_GENRES = 'all';

export function GenreFilter({
    genreId,
    onChange,
}: {
    genreId: number | undefined;
    onChange: (genreId: number | undefined) => void;
}) {
    const { data: genres } = useGenres();

    const items: SelectItem<string>[] = [
        { value: ALL_GENRES, label: 'All genres' },
        ...(genres ?? []).map((genre) => ({ value: String(genre.id), label: genre.name })),
    ];

    return (
        <Select
            aria-label='Filter by genre'
            items={items}
            value={genreId !== undefined ? String(genreId) : ALL_GENRES}
            onValueChange={(value) => onChange(value === ALL_GENRES ? undefined : Number(value))}
        />
    );
}
