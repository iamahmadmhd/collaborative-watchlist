import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/claim-handle';
import type { Schema } from '../../data/resource';

// claim-handle — System Design §4.2, ADR-008, ADR-010, ties to FR-AUTH-3/4 and V-1
//
// Revised in v1.2 (ADR-010): no longer the primary onboarding path — sign-up now
// submits the desired handle as a Cognito custom attribute, and post-confirmation
// claims it atomically the moment the emailed code is verified (no authenticated
// session exists yet at signUp() time for THIS function to be callable then).
// This function is retained as the Settings-only recovery path for a member whose
// post-confirmation claim lost the race: the "ALREADY_CLAIMED" check below is what
// keeps it a first-claim-only operation, not a handle-change mechanism (System
// Design §9 #6 — handle changes are still unsupported; claiming a first handle is
// the one exception).
//
// Conditional write against the Handle table, keyed on the handle string,
// conditioned on `attribute_not_exists(handle)`. That condition is not
// written explicitly here — it's the standard behaviour of Amplify's
// generated `create` resolver, which always PutItems conditioned on
// attribute_not_exists of the model's primary key. Since Handle's identifier
// IS the handle string, `client.models.Handle.create()` below gets the
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
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

type Args = Schema['claimHandle']['args'];
type Result = Schema['claimHandle']['returnType'];

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
    const userId = (event.identity as AppSyncIdentityCognito).sub;
    const handle = event.arguments.handle.trim().toLowerCase();

    if (!HANDLE_PATTERN.test(handle)) {
        return { success: false, handle: null, error: 'INVALID_FORMAT' };
    }

    const { data: profile, errors: profileErrors } = await client.models.UserProfile.get({ id: userId });
    if (profileErrors) {
        throw new Error(`claim-handle: failed to read UserProfile: ${JSON.stringify(profileErrors)}`);
    }
    // FR-AUTH-3 / System Design §9 known limitation 6: handle changes are not
    // supported in this release, so a member with a handle already may not
    // claim another one.
    if (profile?.handle) {
        return { success: false, handle: null, error: 'ALREADY_CLAIMED' };
    }

    const { data: createdHandle, errors: createErrors } = await client.models.Handle.create({ handle, userId });
    if (createErrors) {
        if (isConditionalCheckFailure(createErrors)) {
            return { success: false, handle: null, error: 'ALREADY_TAKEN' };
        }
        throw new Error(`claim-handle: failed to create Handle: ${JSON.stringify(createErrors)}`);
    }
    if (!createdHandle) {
        throw new Error(`claim-handle: Handle.create() for "${handle}" returned no data and no errors`);
    }

    const { errors: updateErrors } = await client.models.UserProfile.update({ id: userId, handle });
    if (updateErrors) {
        // Best-effort compensating delete: this is not FR-MEM-8's transactional
        // guarantee (that's scoped to watchlist membership), but leaving the
        // handle permanently reserved against a profile that never got it is
        // worse than trying to release it. If this delete also fails, the
        // handle is orphaned-reserved — a known limitation, not silently
        // "fixed" by pretending the claim succeeded.
        await client.models.Handle.delete({ handle }).catch(() => undefined);
        throw new Error(
            `claim-handle: failed to update UserProfile after reserving "${handle}": ${JSON.stringify(updateErrors)}`,
        );
    }

    return { success: true, handle: createdHandle.handle, error: null };
};

function isConditionalCheckFailure(errors: ReadonlyArray<{ errorType?: string; message?: string }>): boolean {
    return errors.some(
        (e) =>
            e.errorType?.includes('ConditionalCheckFailedException') ||
            e.message?.includes('ConditionalCheckFailedException'),
    );
}
