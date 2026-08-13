// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import boundaries from 'eslint-plugin-boundaries';
import checkFile from 'eslint-plugin-check-file';

// Enforces System Design §2.2:
// - app > pages > features > entities > shared, strictly downward
// - slices within a layer never import each other
// - Base UI is only ever imported inside shared/ui
export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
            boundaries,
            'check-file': checkFile,
        },
        settings: {
            'boundaries/elements': [
                // Route files are app-layer: they compose pages and own no domain logic.
                // They live in src/app/router/ (routesDirectory, see vite.config.ts /
                // tsr.config.json), so this one pattern already covers them.
                { type: 'app', pattern: 'src/app/*' },
                { type: 'pages', pattern: 'src/pages/*/*', capture: ['slice'] },
                { type: 'features', pattern: 'src/features/*/*', capture: ['slice'] },
                { type: 'entities', pattern: 'src/entities/*/*', capture: ['slice'] },
                { type: 'shared', pattern: 'src/shared/*' },
            ],
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            ...jsxA11y.flatConfigs.recommended.rules,
            // Naming rule: kebab-case for every file and folder under src/. Component
            // *export* names stay PascalCase as normal — this is filesystem-only.
            'check-file/filename-naming-convention': [
                'error',
                { '**/*.{ts,tsx}': 'KEBAB_CASE' },
                { ignoreMiddleExtensions: true },
            ],
            'check-file/folder-naming-convention': [
                'error',
                { 'src/**/': 'KEBAB_CASE', 'amplify/**/': 'KEBAB_CASE', 'tests/**/': 'KEBAB_CASE' },
            ],
            'boundaries/dependencies': [
                'error',
                {
                    default: 'disallow',
                    policies: [
                        {
                            from: { element: { type: 'app' } },
                            allow: [
                                // app isn't sliced like pages/features/entities — src/routes/**
                                // (app-layer per CLAUDE.md) composes src/app/{providers,router,layouts,styles}.
                                { to: { element: { type: 'app' } } },
                                { to: { element: { type: 'pages' } } },
                                { to: { element: { type: 'features' } } },
                                { to: { element: { type: 'entities' } } },
                                { to: { element: { type: 'shared' } } },
                            ],
                        },
                        {
                            from: { element: { type: 'pages' } },
                            allow: [
                                { to: { element: { type: 'features' } } },
                                { to: { element: { type: 'entities' } } },
                                { to: { element: { type: 'shared' } } },
                            ],
                        },
                        {
                            from: { element: { type: 'features' } },
                            allow: [{ to: { element: { type: 'entities' } } }, { to: { element: { type: 'shared' } } }],
                        },
                        {
                            from: { element: { type: 'entities' } },
                            allow: [{ to: { element: { type: 'shared' } } }],
                        },
                        {
                            from: { element: { type: 'shared' } },
                            allow: [{ to: { element: { type: 'shared' } } }],
                        },
                    ],
                },
            ],
            'boundaries/no-private': 'off',
            // No barrel imports from aws-amplify; subpath only (System Design §2.6)
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'aws-amplify',
                            message: "Import from 'aws-amplify/api' or 'aws-amplify/auth' subpaths only.",
                        },
                        {
                            name: '@aws-amplify/ui-react',
                            message: 'Not a dependency (ADR-005) — build auth forms against aws-amplify/auth directly.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Base UI may only be imported inside shared/ui — every primitive is wrapped once there.
        files: ['src/**/*.{ts,tsx}'],
        ignores: ['src/shared/ui/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@base-ui/*'],
                            message: 'Base UI is wrapped once in src/shared/ui — import the wrapper, not the library.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // TanStack Router owns the filenames in its routes directory (src/app/router/,
        // configured as routesDirectory): __root.tsx, route.tsx, index.tsx, _layout.tsx,
        // $movieId.tsx. These encode routing semantics — the router will not find them
        // under any other name, so this is a framework contract, not a style choice.
        // Folder names are exempt for the same reason ($listId/, _authenticated/).
        // Everything else under src/ still follows kebab-case.
        files: ['src/app/router/**/*.{ts,tsx}'],
        rules: {
            'check-file/filename-naming-convention': 'off',
            'check-file/folder-naming-convention': 'off',
        },
    },
    {
        // .amplify/ is where `ampx sandbox` actually writes generated env types (repo
        // root, not nested under amplify/ — verified against a real sandbox run).
        ignores: ['dist/**', '.amplify/**', '**/*.gen.ts'],
    },
);
