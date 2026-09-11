import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '$amplify/env/claim-username';
import type { Schema } from '../../data/resource';

// Claims a username for the caller. First-claim-only: the ALREADY_CLAIMED check
// below is what stops this becoming a username-change mechanism.
//
// Uniqueness comes from the conditional write against the Username table, not from
// the pre-checks here. That condition is never written explicitly — Amplify's
// generated create resolver always PutItems conditioned on attribute_not_exists of
// the primary key, and Username's identifier is the username string itself. Two
// concurrent callers can both pass the pre-checks; only one create() succeeds.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

// UserProfile is read and written directly rather than through the generated
// resolvers: UserProfile.username's field-level rule denies every GraphQL writer,
// and allow.resource() has no field-level form to carve this function out of it.
// It also makes the ALREADY_CLAIMED check atomic — the conditional UpdateItem below
// re-asserts attribute_not_exists(username) at write time.
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME!;

// Not shared with the frontend form: amplify/** and src/** are separate compilation
// contexts, so the client-side copy of this check is a deliberate duplicate. This is
// the enforced one.
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
    // Username changes are unsupported, so a member who already has one may not
    // claim another. Fast path only — the conditional write below enforces it.
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
                // Set explicitly: a raw write bypasses the generated resolver that
                // would populate it, and the field is non-null in the generated
                // schema — a missing one nulls the whole item on read.
                UpdateExpression: 'SET username = :username, updatedAt = :updatedAt',
                // attribute_exists(id) guards against UpdateItem's default upsert
                // conjuring a profile row post-confirmation never created;
                // attribute_not_exists(username) is the real ALREADY_CLAIMED gate.
                ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(username)',
                ExpressionAttributeValues: { ':username': username, ':updatedAt': new Date().toISOString() },
            }),
        );
    } catch (err) {
        // Best-effort compensating delete — not a transactional guarantee. If it
        // also fails the username stays reserved against a profile that never got
        // it, which is reported rather than papered over.
        await client.models.Username.delete({ username }).catch(() => undefined);
        if (err instanceof ConditionalCheckFailedException) {
            // Either a concurrent claim by this member won, or the profile row is
            // missing. Both mean "cannot claim now", and the reservation is released.
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
