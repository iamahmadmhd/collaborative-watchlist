import { describe, it } from 'vitest';

// SRS §6.1's authorization matrix. Every cell must be asserted against the API layer —
// the generated data client or a direct AppSync call — never against the UI: a passing
// "button is hidden" test proves nothing about the security property.

type Actor = 'Owner' | 'Editor' | 'Viewer' | 'Non-member' | 'Removed member';
type Operation = 'read items' | 'add item' | 'remove item' | 'rename list' | 'change membership' | 'delete list';

const matrix: Record<Actor, Record<Operation, 'allow' | 'deny'>> = {
    Owner: {
        'read items': 'allow',
        'add item': 'allow',
        'remove item': 'allow',
        'rename list': 'allow',
        'change membership': 'allow',
        'delete list': 'allow',
    },
    Editor: {
        'read items': 'allow',
        'add item': 'allow',
        'remove item': 'allow',
        'rename list': 'allow',
        'change membership': 'deny',
        'delete list': 'deny',
    },
    Viewer: {
        'read items': 'allow',
        'add item': 'deny',
        'remove item': 'deny',
        'rename list': 'deny',
        'change membership': 'deny',
        'delete list': 'deny',
    },
    'Non-member': {
        'read items': 'deny',
        'add item': 'deny',
        'remove item': 'deny',
        'rename list': 'deny',
        'change membership': 'deny',
        'delete list': 'deny',
    },
    'Removed member': {
        'read items': 'deny',
        'add item': 'deny',
        'remove item': 'deny',
        'rename list': 'deny',
        'change membership': 'deny',
        'delete list': 'deny',
    },
};

for (const [actor, operations] of Object.entries(matrix) as [Actor, Record<Operation, 'allow' | 'deny'>][]) {
    describe(`watchlist authorization: ${actor}`, () => {
        for (const [operation, expected] of Object.entries(operations) as [Operation, 'allow' | 'deny'][]) {
            it.todo(`${expected}s "${operation}" against the API`);
        }
    });
}
