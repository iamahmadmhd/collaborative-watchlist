import { describe, expect, it, vi } from 'vitest';
import { listAll, throwOnErrors } from './amplify-result';

describe('throwOnErrors', () => {
    it('does nothing when there are no errors', () => {
        expect(() => throwOnErrors(undefined, 'fallback')).not.toThrow();
        expect(() => throwOnErrors([], 'fallback')).not.toThrow();
    });

    it('throws the first error message, falling back when it is empty', () => {
        expect(() => throwOnErrors([{ message: 'Unauthorized' }], 'fallback')).toThrow('Unauthorized');
        expect(() => throwOnErrors([{ message: '' }], 'fallback')).toThrow('fallback');
    });
});

describe('listAll', () => {
    it('drains every page rather than returning the first', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ data: [1, 2], nextToken: 'a' })
            .mockResolvedValueOnce({ data: [3], nextToken: 'b' })
            .mockResolvedValueOnce({ data: [4], nextToken: null });

        await expect(listAll<number>(fetchPage, 'fallback')).resolves.toEqual([1, 2, 3, 4]);
        expect(fetchPage).toHaveBeenCalledTimes(3);
        expect(fetchPage.mock.calls.map(([token]) => token)).toEqual([null, 'a', 'b']);
    });

    it('stops on a missing nextToken', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ data: [1] });
        await expect(listAll<number>(fetchPage, 'fallback')).resolves.toEqual([1]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('throws rather than returning a partial list when a page carries errors', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ data: [1], nextToken: 'a' })
            .mockResolvedValueOnce({ data: [], errors: [{ message: 'Unauthorized' }] });

        await expect(listAll<number>(fetchPage, 'fallback')).rejects.toThrow('Unauthorized');
    });

    it('throws on a first page that failed, rather than reading as empty', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ data: [], errors: [{ message: 'Network error' }] });
        await expect(listAll<number>(fetchPage, 'fallback')).rejects.toThrow('Network error');
    });
});
