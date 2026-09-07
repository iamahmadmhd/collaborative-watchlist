import { z } from 'zod';

// FR-DISC-5: filters and pagination live in the URL, Zod-validated, so they
// survive refresh/back-navigation/sharing (System Design §2.3). `.catch()`
// rather than `.optional()`/required on `page` matches the recovery style
// already used by the auth routes' search schemas — a malformed value falls
// back instead of producing a route error for "someone hand-edited the URL."
export const discoverSearchSchema = z.object({
    genreId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).catch(1),
});

export type DiscoverSearch = z.infer<typeof discoverSearchSchema>;
