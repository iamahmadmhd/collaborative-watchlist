import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

// The client is instantiated once per execution environment and reused across warm
// invocations.
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// TTLs in seconds.
export const CACHE_TTL_SECONDS = {
    genres: 60 * 60 * 24 * 7,
    trending: 60 * 60,
    discover: 60 * 60,
    movie: 60 * 60 * 24,
    search: 60 * 15,
} as const;

// Keys are normalised — lowercased/trimmed search terms, sorted genre ids — or
// "The Matrix" and "the matrix" occupy separate entries and halve the hit rate.
export const cacheKeys = {
    genres: (): string => 'genres',
    trending: (page: number): string => `trending#week#p${page}`,
    discover: (genreIds: readonly number[], page: number): string =>
        `discover#${[...genreIds].sort((a, b) => a - b).join(',')}#p${page}`,
    movie: (tmdbId: string): string => `movie#${tmdbId}`,
    search: (query: string, page: number): string => `search#${query.trim().toLowerCase()}#p${page}`,
};

export function createCacheStore(tableName: string) {
    return {
        async get<T>(cacheKey: string): Promise<T | null> {
            const { Item } = await docClient.send(new GetCommand({ TableName: tableName, Key: { cacheKey } }));
            if (!Item) {
                return null;
            }
            // TTL deletion can lag up to 48h past expiry, so row existence is not a hit:
            // compare expiresAt explicitly and treat stale-but-present as a miss.
            const nowEpochSeconds = Math.floor(Date.now() / 1000);
            if (typeof Item.expiresAt !== 'number' || Item.expiresAt <= nowEpochSeconds) {
                return null;
            }
            return JSON.parse(Item.payload as string) as T;
        },

        async put(cacheKey: string, payload: unknown, ttlSeconds: number): Promise<void> {
            const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
            await docClient.send(
                new PutCommand({
                    TableName: tableName,
                    Item: { cacheKey, payload: JSON.stringify(payload), expiresAt },
                }),
            );
        },
    };
}
