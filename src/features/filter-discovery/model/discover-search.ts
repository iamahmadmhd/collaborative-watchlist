import { z } from 'zod';

// Filters and pagination live in the URL, Zod-validated, so they survive refresh,
// back-navigation and sharing. `.catch()` rather than required: a hand-edited URL
// falls back instead of producing a route error.
export const discoverSearchSchema = z.object({
    genreId: z.coerce.number().int().positive().optional().catch(undefined),
    page: z.coerce.number().int().min(1).catch(1),
});

export type DiscoverSearch = z.infer<typeof discoverSearchSchema>;
