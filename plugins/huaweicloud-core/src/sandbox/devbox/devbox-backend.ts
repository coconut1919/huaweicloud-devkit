// Sandbox backend posture: legacy (DevStation/hwlink) or devbox (platform
// resource pool). The env var is the operator posture; after a successful
// connect the workspace's backend is pinned in-process so a mid-session env
// flip can never route one workspace across backends.

export type SandboxBackend = 'legacy' | 'devbox';

const workspaceBackends = new Map<string, SandboxBackend>();

export function sandboxBackend(): SandboxBackend {
  const raw = process.env.HW_SANDBOX_BACKEND;
  if (raw === undefined || raw === '' || raw === 'legacy') return 'legacy';
  if (raw === 'devbox') return 'devbox';
  throw new Error(
    `HW_SANDBOX_BACKEND must be "legacy" or "devbox" (got "${raw}"). ` +
      'Unknown values fail fast at startup instead of silently routing sandbox traffic.',
  );
}

export function isDevboxBackend(): boolean {
  return sandboxBackend() === 'devbox';
}

export function rememberWorkspaceBackend(workspaceId: string, backend: SandboxBackend): void {
  if (!workspaceId) return;
  workspaceBackends.set(workspaceId, backend);
}

export function forgetWorkspaceBackend(workspaceId: string): void {
  workspaceBackends.delete(workspaceId);
}

/** Backend this workspace was connected on; falls back to the operator posture. */
export function backendForWorkspace(workspaceId: string | null | undefined): SandboxBackend {
  if (workspaceId) {
    const pinned = workspaceBackends.get(workspaceId);
    if (pinned) return pinned;
  }
  return sandboxBackend();
}

export function _clearWorkspaceBackendsForTests(): void {
  workspaceBackends.clear();
}
