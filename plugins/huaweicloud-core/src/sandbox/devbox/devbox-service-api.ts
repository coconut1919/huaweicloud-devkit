// DevBox control plane over hdkitservice (`/sandbox/devbox/*`). Every call
// carries the user's AK/SK (+ optional X-HW-Security-Token) through the one
// shared hdkitRequest seam — there is no sandbox key. EnvD tokens returned by
// connect/refresh stay in the in-process connection cache only.

import { asRecord } from '../../lib/as-record.ts';
import { hdkitRequest } from '../../lib/hdkit/hdkitservice-api.ts';
import {
  requireDevboxConnection,
  devboxTokenNeedsRefresh,
  setDevboxConnectionFromResponse,
  type DevboxConnectionRecord,
} from './devbox-connections.ts';

export const DEVBOX_CONNECT_TIMEOUT_DEFAULT = 1800;
const DEVBOX_CONNECT_TIMEOUT_MIN = 10;
const DEVBOX_CONNECT_TIMEOUT_MAX = 86400;

export function devboxConnectTimeoutSeconds(): number {
  const raw = process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS;
  if (raw === undefined || raw === '') return DEVBOX_CONNECT_TIMEOUT_DEFAULT;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < DEVBOX_CONNECT_TIMEOUT_MIN || value > DEVBOX_CONNECT_TIMEOUT_MAX) {
    throw new Error(
      `HW_SANDBOX_CONNECT_TIMEOUT_SECONDS must be an integer between ${DEVBOX_CONNECT_TIMEOUT_MIN} and ` +
        `${DEVBOX_CONNECT_TIMEOUT_MAX} (got "${raw}").`,
    );
  }
  return value;
}

export interface DevboxConnectOptions {
  timeoutSeconds?: number;
  source?: string;
  envVars?: Record<string, string>;
  poolType?: string;
}

export async function devboxConnect(options: DevboxConnectOptions = {}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    timeout: options.timeoutSeconds ?? devboxConnectTimeoutSeconds(),
    source: options.source || 'CLI',
  };
  if (options.envVars && Object.keys(options.envVars).length > 0) body.envVars = options.envVars;
  if (options.poolType) body.pool_type = options.poolType;
  return asRecord(await hdkitRequest('POST', 'sandbox/devbox/connect', body, 300000));
}

export async function devboxRefresh(sandboxId: string, timeoutSeconds?: number): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    timeout: timeoutSeconds ?? devboxConnectTimeoutSeconds(),
  };
  return asRecord(await hdkitRequest('POST', `sandbox/devbox/${encodeURIComponent(sandboxId)}/connect`, body, 120000));
}

export async function devboxShutdown(sandboxId: string): Promise<Record<string, unknown>> {
  return asRecord(await hdkitRequest('POST', `sandbox/devbox/${encodeURIComponent(sandboxId)}/shutdown`, {}, 120000));
}

export async function devboxKill(sandboxId: string): Promise<Record<string, unknown>> {
  return asRecord(await hdkitRequest('DELETE', `sandbox/devbox/${encodeURIComponent(sandboxId)}`, undefined, 120000));
}

export async function devboxStatus(sandboxId: string): Promise<Record<string, unknown>> {
  return asRecord(await hdkitRequest('GET', `sandbox/devbox/${encodeURIComponent(sandboxId)}`, undefined, 30000));
}

/** True for EnvD 401/403 — triggers the one automatic refresh+retry. */
export function isDevboxAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const rec = error as { auth?: unknown; status?: unknown };
  return rec.auth === true || rec.status === 401 || rec.status === 403;
}

/** Calls hdkitservice refresh with the current AK/SK and updates the cache. */
export async function refreshDevboxConnection(connection: DevboxConnectionRecord): Promise<DevboxConnectionRecord> {
  const result = await devboxRefresh(connection.sandboxId);
  return setDevboxConnectionFromResponse(connection.workspaceId, result);
}

/**
 * Data-plane wrapper: refresh the EnvD token five minutes before expiry, and
 * on a 401/403 refresh once and retry the same operation. A second auth
 * failure is returned to the caller (control-plane re-authentication is the
 * agent's next action).
 */
export async function withDevboxConnection<T>(
  workspaceId: string,
  operation: (connection: DevboxConnectionRecord) => Promise<T>,
): Promise<T> {
  let connection = requireDevboxConnection(workspaceId);
  if (devboxTokenNeedsRefresh(connection)) {
    connection = await refreshDevboxConnection(connection);
  }
  try {
    return await operation(connection);
  } catch (error) {
    if (!isDevboxAuthError(error)) throw error;
    const refreshed = await refreshDevboxConnection(requireDevboxConnection(workspaceId));
    return await operation(refreshed);
  }
}
