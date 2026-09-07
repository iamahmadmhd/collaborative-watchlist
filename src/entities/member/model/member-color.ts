// Design System §3.4 (Attribution Stripe): member colour is generated, not
// assigned — hue = hash(userId) % 360, two fixed OKLCH lightness constants
// (0.55 light / 0.72 dark) so every member reads with consistent visual weight
// regardless of hue. docs/design/README's "known conflict" #1 flags that the
// board instead hardcodes a fixed 5-swatch palette (`--m1`..`--m5` in
// styles.css) for its demo members — but those five hues (258/24/152/88/310)
// and both lightness constants match this formula exactly, so the board reads
// as five fixed sample points of this same function, not a different
// mechanism. §3 is authoritative per docs/design/README and CLAUDE.md, so this
// implements the real per-user hash rather than cycling the five board tokens;
// flagged here rather than resolved silently either way.
//
// `light-dark()` picks the pair by the used `color-scheme` (styles.css sets
// `color-scheme: light` on `:root` and `dark` on `.dark`) — this stays correct
// across the light/dark/system theme toggle without needing to know, in this
// module, which one is active (System Design §3.2's theme system is a later
// build step; this doesn't need to wait on it).
function hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash << 5) - hash + userId.charCodeAt(i);
        hash |= 0; // force 32-bit wraparound (standard djb2-style string hash)
    }
    return Math.abs(hash);
}

export function memberColor(userId: string): string {
    const hue = hashUserId(userId) % 360;
    return `light-dark(oklch(0.55 0.15 ${hue}), oklch(0.72 0.14 ${hue}))`;
}

export function memberInitial(displayName: string): string {
    return displayName.trim().charAt(0).toUpperCase() || '?';
}
