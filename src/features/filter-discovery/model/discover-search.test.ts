import { describe, expect, it } from 'vitest';
import { discoverSearchSchema } from './discover-search';

// A hand-edited or stale URL must fall back, not fail the route.
describe('discoverSearchSchema', () => {
    it('coerces valid params', () => {
        expect(discoverSearchSchema.parse({ genreId: '28', page: '3' })).toEqual({ genreId: 28, page: 3 });
    });

    it('falls back on an unparseable genreId', () => {
        expect(discoverSearchSchema.parse({ genreId: 'abc', page: '1' })).toEqual({ genreId: undefined, page: 1 });
    });

    it('falls back on an out-of-range genreId', () => {
        expect(discoverSearchSchema.parse({ genreId: '-3', page: '1' })).toEqual({ genreId: undefined, page: 1 });
    });

    it('falls back on an unparseable page', () => {
        expect(discoverSearchSchema.parse({ page: 'x' })).toEqual({ genreId: undefined, page: 1 });
    });
});
