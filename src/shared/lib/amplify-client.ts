import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../../amplify/data/resource';

// One generateClient<Schema>() for the whole frontend: calling it per module would
// construct a separate client each time for no benefit.
export const client = generateClient<Schema>();
