import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../../amplify/data/resource';

// One generateClient<Schema>() for the whole frontend (System Design §2.2 —
// shared/lib owns "amplify client"). entities/*/api and features/*/api import
// this instead of each calling generateClient() itself, which would otherwise
// construct a separate client per module for no benefit. `aws-amplify/api`
// only (CLAUDE.md) — never the `aws-amplify` barrel.
export const client = generateClient<Schema>();
