import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '$amplify/env/claim-username';
import type { Schema } from '../../data/resource';

// claim-username — System Design §4.2, ADR-008, ADR-011, ties to FR-AUTH-3/4 and V-1
//
// Revised in v1.4 (ADR-011): back to being the primary path — the post-verification
// username screen calls this, authenticated, once the emailed code is verified.
// Settings calls the same function as the narrower recovery path, for a member who
// verified but never finished that screen. The "ALREADY_CLAIMED" check below is what
// keeps it a first-claim-only operation, not a username-change mechanism (System
// Design §9 #6 — username changes are still unsupported; claiming a first one is
// the one exception).
//
// Conditional write against the Username table, keyed on the username string,
// conditioned on `attribute_not_exists(username)`. That condition is not
// written explicitly here — it's the standard behaviour of Amplify's
// generated `create` resolver, which always PutItems conditioned on
// attribute_not_exists of the model's primary key. Since Username's identifier
// IS the username string, `client.models.Username.create()` below gets the
// atomicity guarantee for free. This function's own pre-checks (format,
// already-claimed) are UX-quality-of-life only; the create call is the
// actual mechanism behind FR-AUTH-4 and V-1 (two concurrent callers can both
// pass the checks below — only one create() call will succeed).

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

// UserProfile is read and written directly, not through the generated resolvers,
// while Username stays on AppSync (above) because its create() is the conditional
// write this whole function turns on. The split is forced by UserProfile.username's
// field-level authorization (data/resource.ts): that rule exists so no member can
// rewrite their own handle, and `allow.resource()` has no field-level form in the
// installed @aws-amplify/data-schema to carve this function back out of it. Going
// under AppSync for this one field sidesteps that entirely — the same reason
// membership/handler.ts writes Watchlist.editors/viewers over the raw SDK.
//
// It also makes the ALREADY_CLAIMED check atomic rather than advisory: the
// conditional UpdateItem below re-asserts attribute_not_exists(username) at write
// time, so two concurrent claims by the same member can't both get past the read.
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME!;

// Not shared with the frontend form: amplify/** and src/** are separate
// compilation contexts (no cross-boundary import), so the client-side
// version of this check (System Design §2.5 — "UX only") is a deliberate,
// separately-maintained duplicate. This is the one that's actually enforced.
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

type Args = Schema['claimUsername']['args'];
type Result = Schema['claimUsername']['returnType'];

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
    const userId = (event.identity as AppSyncIdentityCognito).sub;
    const username = event.arguments.username.trim().toLowerCase();

    if (!USERNAME_PATTERN.test(username)) {
        return { success: false, username: null, error: 'INVALID_FORMAT' };
    }

    const { Item: profile } = await docClient.send(
        new GetCommand({ TableName: USER_PROFILE_TABLE, Key: { id: userId } }),
    );
    // FR-AUTH-3 / System Design §9 known limitation 6: username changes are not
    // supported in this release, so a member with a username already may not
    // claim another one. This is the fast path only — the conditional write below
    // is what actually enforces it.
    if (profile?.username) {
        return { success: false, username: null, error: 'ALREADY_CLAIMED' };
    }

    const { data: createdUsername, errors: createErrors } = await client.models.Username.create({
        username,
        userId,
    });
    if (createErrors) {
        if (isConditionalCheckFailure(createErrors)) {
            return { success: false, username: null, error: 'ALREADY_TAKEN' };
        }
        throw new Error(`claim-username: failed to create Username: ${JSON.stringify(createErrors)}`);
    }
    if (!createdUsername) {
        throw new Error(`claim-username: Username.create() for "${username}" returned no data and no errors`);
    }

    try {
        await docClient.send(
            new UpdateCommand({
                TableName: USER_PROFILE_TABLE,
                Key: { id: userId },
                // updatedAt is maintained explicitly: Amplify only auto-populates it
                // inside the generated resolver, which this raw write bypasses, and
                // its generated schema marks the field non-null — an item missing it
                // resolves to null in full on read (GraphQL null-propagation), the
                // same trap permission-fanout/handler.ts documents for its own raw
                // WatchlistMember writes.
                UpdateExpression: 'SET username = :username, updatedAt = :updatedAt',
                // attribute_exists(id) guards against UpdateItem's default upsert
                // conjuring a profile row post-confirmation never created;
                // attribute_not_exists(username) is the real ALREADY_CLAIMED gate.
                ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(username)',
                ExpressionAttributeValues: { ':username': username, ':updatedAt': new Date().toISOString() },
            }),
        );
    } catch (err) {
        // Best-effort compensating delete: this is not FR-MEM-8's transactional
        // guarantee (that's scoped to watchlist membership), but leaving the
        // username permanently reserved against a profile that never got it is
        // worse than trying to release it. If this delete also fails, the
        // username is orphaned-reserved — a known limitation, not silently
        // "fixed" by pretending the claim succeeded.
        await client.models.Username.delete({ username }).catch(() => undefined);
        if (err instanceof ConditionalCheckFailedException) {
            // Either a concurrent claim by this same member won the race, or the
            // profile row is missing entirely. Both are "you can't claim now", and
            // the reservation has just been released either way.
            return { success: false, username: null, error: 'ALREADY_CLAIMED' };
        }
        throw new Error(`claim-username: failed to update UserProfile after reserving "${username}"`, {
            cause: err,
        });
    }

    return { success: true, username: createdUsername.username, error: null };
};

function isConditionalCheckFailure(errors: ReadonlyArray<{ errorType?: string; message?: string }>): boolean {
    return errors.some(
        (e) =>
            e.errorType?.includes('ConditionalCheckFailedException') ||
            e.message?.includes('ConditionalCheckFailedException'),
    );
}
