import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
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

    const { data: profile, errors: profileErrors } = await client.models.UserProfile.get({ id: userId });
    if (profileErrors) {
        throw new Error(`claim-username: failed to read UserProfile: ${JSON.stringify(profileErrors)}`);
    }
    // FR-AUTH-3 / System Design §9 known limitation 6: username changes are not
    // supported in this release, so a member with a username already may not
    // claim another one.
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

    const { errors: updateErrors } = await client.models.UserProfile.update({ id: userId, username });
    if (updateErrors) {
        // Best-effort compensating delete: this is not FR-MEM-8's transactional
        // guarantee (that's scoped to watchlist membership), but leaving the
        // username permanently reserved against a profile that never got it is
        // worse than trying to release it. If this delete also fails, the
        // username is orphaned-reserved — a known limitation, not silently
        // "fixed" by pretending the claim succeeded.
        await client.models.Username.delete({ username }).catch(() => undefined);
        throw new Error(
            `claim-username: failed to update UserProfile after reserving "${username}": ${JSON.stringify(updateErrors)}`,
        );
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
