// In-process DevBox connection cache (workspace -> single-sandbox EnvD
// credentials). Tokens are process-memory only: never serialized, never
// logged, never returned in a tool result. A devkit restart requires a
// fresh connect with valid AK/SK (A posture — no sandbox key).

export interface DevboxConnectionRecord {
  workspaceId: string;
  sandboxId: string;
  state: string;
  templateId?: string;
  envdUrl: string;
  tunnelId?: string;
  connectToken: string;
  envdAccessToken?: string;
  envdVersion?: string;
  /** ISO-8601 (the hdkitservice response shape). */
  tokenExpiration?: string;
  /** ISO-8601 sandbox TTL end. */
  endAt?: string;
  poolType: string;
  started: boolean;
  pauseRetentionHours?: number;
}

const connections = new Map<string, DevboxConnectionRecord>();

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Fold a hdkitservice devbox connect/refresh response into the cache. */
export function setDevboxConnectionFromResponse(
  workspaceId: string,
  result: Record<string, unknown>,
): DevboxConnectionRecord {
  const sandboxId =
    str(result.sandbox_id) || str(result.sandboxId) || str(result.session_id) || str(result.dev_stage_id);
  if (!sandboxId) {
    throw new Error('DevBox connect response did not include a sandbox id — refusing to cache a partial connection.');
  }
  const envdUrl = str(result.envd_url) || str(result.envdUrl);
  const connectToken = str(result.connect_token) || str(result.connectToken);
  if (!envdUrl || !connectToken) {
    throw new Error(
      'DevBox connect response did not include EnvD credentials — refusing to cache a partial connection.',
    );
  }
  const existing = connections.get(workspaceId);
  const record: DevboxConnectionRecord = {
    workspaceId,
    sandboxId,
    state: str(result.state) || 'running',
    templateId: str(result.template_id) || str(result.templateId) || existing?.templateId,
    envdUrl,
    tunnelId: str(result.tunnel_id) || str(result.tunnelId),
    connectToken,
    envdAccessToken: str(result.envd_access_token) || str(result.envdAccessToken),
    envdVersion: str(result.envd_version) || str(result.envdVersion),
    tokenExpiration: str(result.token_expiration) || str(result.tokenExpiration),
    endAt: str(result.end_at) || str(result.endAt),
    poolType: str(result.pool_type) || str(result.poolType) || 'ephemeral',
    started: result.started === true,
    pauseRetentionHours:
      typeof result.pause_retention_hours === 'number'
        ? result.pause_retention_hours
        : typeof result.pauseRetentionHours === 'number'
          ? result.pauseRetentionHours
          : existing?.pauseRetentionHours,
  };
  connections.set(workspaceId, record);
  // The sandbox id is the workspace id on the devbox path; keep the alias hot
  // so a caller holding either identifier resolves the same cache entry.
  if (sandboxId !== workspaceId) connections.set(sandboxId, record);
  return record;
}

export function getDevboxConnection(workspaceId: string | null | undefined): DevboxConnectionRecord | undefined {
  if (!workspaceId) return undefined;
  return connections.get(workspaceId);
}

export function requireDevboxConnection(workspaceId: string): DevboxConnectionRecord {
  const connection = connections.get(workspaceId);
  if (!connection) {
    throw new Error(
      `No DevBox connection for workspace "${workspaceId}" in this process. ` +
        'Call huaweicloud_sandbox_connect again with valid AK/SK — devbox tokens are memory-only and do not survive a restart.',
    );
  }
  return connection;
}

export function clearDevboxConnection(workspaceId: string | null | undefined): void {
  if (!workspaceId) return;
  const connection = connections.get(workspaceId);
  if (!connection) return;
  connections.delete(connection.workspaceId);
  connections.delete(connection.sandboxId);
}

export function _clearDevboxConnectionsForTests(): void {
  connections.clear();
}

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** True when the EnvD token expires inside the refresh window (or is unparsable). */
export function devboxTokenNeedsRefresh(connection: DevboxConnectionRecord): boolean {
  if (!connection.tokenExpiration) return false;
  const raw = connection.tokenExpiration.trim();
  const epochSeconds = Number(raw);
  const expiresAt = Number.isFinite(epochSeconds) ? epochSeconds * 1000 : Date.parse(raw);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + TOKEN_REFRESH_WINDOW_MS;
}
