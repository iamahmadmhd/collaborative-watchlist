export interface CurrentUser {
    id: string;
    username: string | null;
    displayName: string | null;
    // Read through so a future editor isn't blocked on this type; nothing writes it
    // today — no storage backend is provisioned for uploads.
    avatarUrl: string | null;
    // Amplify Data's auto-managed timestamp, not a field the schema declares.
    joinedAt: string | null;
}
