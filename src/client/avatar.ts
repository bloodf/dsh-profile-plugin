/** Deterministic avatar SVG and scoped profile color from a seed string. */

/** FNV-1a hash matching the Host model's stableHash. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626',
  '#ea580c', '#ca8a04', '#16a34a', '#0891b2',
] as const

export function defaultColor(id: string): string {
  return PALETTE[stableHash(id) % PALETTE.length]!
}

export function defaultAvatarSeed(id: string): string {
  return `company-${stableHash(id).toString(36)}`
}

/**
 * Generate a deterministic avatar as a data:URI SVG.
 * Uses the seed to derive a 4x4 symmetric pixel grid.
 */
export function avatarDataUri(seed: string, color: string): string {
  const h = stableHash(seed)
  // Build 4x4 symmetric grid (mirror horizontally)
  const cells: boolean[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      const bit = ((h >>> ((row * 2 + col) % 32)) & 1) === 1
      cells[row * 4 + col] = bit
      cells[row * 4 + (3 - col)] = bit
    }
  }
  let rects = ''
  for (let i = 0; i < 16; i++) {
    if (cells[i]) {
      const x = (i % 4) * 25
      const y = Math.floor(i / 4) * 25
      rects += `<rect x="${x}" y="${y}" width="25" height="25" fill="${color}"/>`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f3f4f6" rx="8"/>${rects}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Two-letter initials fallback text from a seed. */
export function avatarInitials(seed: string): string {
  return seed.slice(-2).toUpperCase()
}
