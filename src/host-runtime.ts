/* Cordis tool-policy wiring and live profile generation reconciliation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDispatchExecution, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { CompanyProfileRegistry } from './registry.js'
import { DEFAULT_PROFILE_ID } from './model.js'
import { ProfileRuntime, type SnapshotLease } from './runtime.js'

export interface DiscoveredToolsProvider {
  tools(profileId: string): readonly string[]
}

export interface HostRuntimeController {
  readonly runtime: ProfileRuntime
  reconcile(): void
}

/**
 * Resolve authoritative profile id from execution context.
 * Uses `exec.agent.session.header.profileId` when present,
 * falls back to `'default'` for legacy sessions without profile identity.
 */
function resolveProfileId(exec: ToolExecution): string {
  const header = exec.agent?.session.header as { profileId?: string } | undefined
  return header?.profileId ?? DEFAULT_PROFILE_ID
}

export function installHostRuntime(
  ctx: Context,
  registry: CompanyProfileRegistry,
  discovered: DiscoveredToolsProvider,
): HostRuntimeController {
  const runtime = new ProfileRuntime()
  const executions = new WeakMap<ToolExecution, SnapshotLease>()

  const reconcile = (): void => {
    const document = registry.snapshot()
    for (const id of document.order) {
      const profile = registry.resolve(id)
      runtime.publish(profile, document.revision, discovered.tools(id))
    }
  }
  reconcile()
  ctx.effect(() => registry.subscribe(() => { reconcile() }), 'company-profiles: reconcile generations')

  ctx.on('tools/pre-execute', async (exec, next) => {
    const profileId = resolveProfileId(exec)
    let lease = executions.get(exec)
    if (lease === undefined) {
      try {
        lease = runtime.admit(profileId, exec.name)
        executions.set(exec, lease)
      } catch {
        return { kind: 'deny', reason: 'PROFILE_CAPABILITY_DENIED' }
      }
    }
    try {
      const decision = await next()
      if (decision.kind !== 'allow') { executions.delete(exec); lease.release() }
      return decision
    } catch (error) {
      executions.delete(exec)
      lease.release()
      throw error
    }
  }, { prepend: true })

  ctx.on('tools/execute', async (exec: ToolDispatchExecution, next): Promise<ToolExecutionResult> => {
    const lease = executions.get(exec)
    const profileId = resolveProfileId(exec)
    if (lease === undefined || lease.snapshot.profileId !== profileId
      || !lease.snapshot.allowedTools.has(exec.name)) {
      return denied(`tool '${exec.name}' has no admitted company profile generation`)
    }
    try { return await next() }
    finally { executions.delete(exec); lease.release() }
  }, { prepend: true })

  return { runtime, reconcile }
}

function denied(message: string): ToolExecutionResult {
  return {
    isError: true,
    error: { message, info: { name: 'CompanyProfileDenied', code: 'PROFILE_CAPABILITY_DENIED' } },
    content: [{ type: 'text', text: message }],
  }
}
