// Member colour is generated, not assigned: hue = hash(userId) % 360, with two fixed
// OKLCH lightness constants so every member reads with the same visual weight.
// light-dark() picks the pair from the used color-scheme, so this module never needs
// to know which theme is active.
function hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash << 5) - hash + userId.charCodeAt(i);
        hash |= 0; // force 32-bit wraparound
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
