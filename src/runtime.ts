/* Immutable exact-name capability generations and per-execution leases. */
import type { ResolvedCompanyProfile } from './model.js'

export interface CapabilitySnapshot {
  readonly profileId: string
  readonly generation: number
  readonly allowedTools: ReadonlySet<string>
  readonly profile: ResolvedCompanyProfile
}

export interface SnapshotLease {
  readonly snapshot: CapabilitySnapshot
  release(): void
}

interface Generation {
  snapshot: CapabilitySnapshot
  leases: number
  retired: boolean
}

export class ProfileRuntime {
  private readonly current = new Map<string, Generation>()
  private readonly retired = new Set<Generation>()

  /** Publish exact public tool names from synchronized MCP discovery. */
  publish(profile: ResolvedCompanyProfile, generation: number, discoveredToolNames: readonly string[]): CapabilitySnapshot {
    const allowed = new Set(discoveredToolNames)
    for (const name of allowed) {
      if (!/^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_.:-]+$/.test(name)) {
        throw new TypeError(`invalid discovered MCP tool name '${name}'`)
      }
    }
    const snapshot: CapabilitySnapshot = Object.freeze({
      profileId: profile.id,
      generation,
      allowedTools: readonlySet(allowed),
      profile: deepFreeze(structuredClone(profile)),
    })
    const previous = this.current.get(profile.id)
    if (previous !== undefined) {
      previous.retired = true
      if (previous.leases > 0) this.retired.add(previous)
    }
    this.current.set(profile.id, { snapshot, leases: 0, retired: false })
    return snapshot
  }

  snapshot(profileId: string): CapabilitySnapshot {
    const generation = this.current.get(profileId)
    if (generation === undefined) throw new Error(`profile '${profileId}' has no active capability generation`)
    return generation.snapshot
  }

  admit(profileId: string, toolName: string): SnapshotLease {
    const generation = this.current.get(profileId)
    if (generation === undefined || !generation.snapshot.allowedTools.has(toolName)) {
      throw new Error(`tool '${toolName}' is disabled for profile '${profileId}'`)
    }
    generation.leases++
    let released = false
    return Object.freeze({
      snapshot: generation.snapshot,
      release: () => {
        if (released) return
        released = true
        generation.leases--
        if (generation.retired && generation.leases === 0) this.retired.delete(generation)
      },
    })
  }

  retiredGenerationCount(): number {
    return this.retired.size
  }
}

function readonlySet<T>(source: Set<T>): ReadonlySet<T> {
  return Object.freeze({
    get size() { return source.size },
    has: (value: T) => source.has(value),
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) => {
      source.forEach(value => callback.call(thisArg, value, value, source))
    },
    [Symbol.iterator]: () => source[Symbol.iterator](),
  })
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}
