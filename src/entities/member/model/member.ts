export interface CurrentUser {
    id: string;
    username: string | null;
    displayName: string | null;
    // FR-AUTH-5's avatar half has no editor yet (Settings, docs/design/Settings.dc.html,
    // has no avatar affordance at all, and no storage backend is provisioned anywhere in
    // System Design §4/§5 to hold an upload) — the field is read through so a future
    // editor isn't blocked on this hook, but nothing writes it today.
    avatarUrl: string | null;
    // docs/design/Settings.dc.html's header subtitle ("joined March 2025") — Amplify
    // Data's own auto-managed timestamp (amplify/functions/permission-fanout/handler.ts's
    // comment confirms generated resolvers set this; only hand-written transactional
    // writes have to set it explicitly), not a field this schema declares itself.
    joinedAt: string | null;
}
