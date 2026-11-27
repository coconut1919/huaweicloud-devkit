// DevBox EnvD data-plane client (one-shot only): Process/Start (non-PTY),
// /files read/write, and a stat helper. No PTY, no Process/Connect, no
// SendInput/SendSignal — the v1 scope pinned by the design.

import { Buffer } from 'node:buffer';

import {
  ConnectFrameDecoder,
  ENVD_API_PORT,
  PROCESS_START_PATH,
  assertConnectContentType,
  buildProcessStartRequest,
  decodeProcessChunk,
  deriveAppPortUrl,
  encodeConnectFrame,
  parseProcessEvent,
} from './devbox-envd-protocol.ts';
import { devboxFetch, rewriteDevboxUrl } from './devbox-envd-transport.ts';
import type { DevboxConnectionRecord } from './devbox-connections.ts';

export interface DevboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid?: number;
}

export class DevboxEnvdHttpError extends Error {
  readonly status: number;
  readonly auth: boolean;
  readonly detail: string | undefined;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'DevboxEnvdHttpError';
    this.status = status;
    this.auth = status === 401 || status === 403;
    this.detail = detail;
  }
}

function envdHeaders(connection: DevboxConnectionRecord): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: `relay_token=${connection.connectToken}`,
    'E2B-Sandbox-Id': connection.sandboxId,
    'E2B-Sandbox-Port': String(ENVD_API_PORT),
  };
  if (connection.envdAccessToken) headers['X-Access-Token'] = connection.envdAccessToken;
  return headers;
}

function timeoutError(timeoutMs: number): Error & { exitCode: number } {
  return Object.assign(
    new Error(`sandbox exec: command timed out after ${timeoutMs}ms (the remote process may still be running).`),
    { exitCode: 124, timeout: true },
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function responseError(response: Awaited<ReturnType<typeof devboxFetch>>): Promise<DevboxEnvdHttpError> {
  let detail: string | undefined;
  try {
    const text = (await response.text()).slice(0, 500);
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      detail =
        (typeof rec.message === 'string' && rec.message) || (typeof rec.error === 'string' && rec.error) || undefined;
    }
  } catch {
    // non-JSON body: status alone is the contract
  }
  return new DevboxEnvdHttpError(
    response.status,
    `DevBox EnvD request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    detail,
  );
}

/**
 * Runs one command to completion (`/bin/bash -l -c <command>`) and collects
 * stdout/stderr/exit code. The client aborts at timeoutMs; the abort surfaces
 * with exitCode 124 (the hwexec async branch treats that as an uncertain start).
 */
export async function execDevboxOneShot(
  connection: DevboxConnectionRecord,
  command: string,
  timeoutMs: number,
): Promise<DevboxExecResult> {
  const payload = buildProcessStartRequest(command);
  const body = encodeConnectFrame(payload);
  const headers: Record<string, string> = {
    ...envdHeaders(connection),
    'Connect-Protocol-Version': '1',
    'Content-Type': 'application/connect+json',
    'Connect-Timeout-Ms': String(Math.max(1, Math.round(timeoutMs))),
    'Keepalive-Ping-Interval': '50',
  };
  const url = new URL(PROCESS_START_PATH, `${connection.envdUrl.replace(/\/$/, '')}/`).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    let response: Awaited<ReturnType<typeof devboxFetch>>;
    try {
      response = await devboxFetch(url, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw timeoutError(timeoutMs);
      throw error;
    }
    if (!response.ok) throw await responseError(response);
    assertConnectContentType(response.headers.get('content-type'));
    if (!response.body) throw new Error('DevBox EnvD returned an empty Connect stream.');

    const reader = response.body.getReader();
    const decoder = new ConnectFrameDecoder();
    const stdoutDecoder = new TextDecoder('utf-8');
    const stderrDecoder = new TextDecoder('utf-8');
    const stdout: string[] = [];
    const stderr: string[] = [];
    let pid: number | undefined;
    let exitCode: number | undefined;
    let endError: { code: string; message: string } | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const fed = decoder.feed(value);
        for (const eventPayload of fed.events) {
          const event = parseProcessEvent(eventPayload);
          if (event.pid !== undefined) pid = event.pid;
          const out = decodeProcessChunk(event.stdoutBase64);
          if (out) {
            const text = stdoutDecoder.decode(out, { stream: true });
            if (text) stdout.push(text);
          }
          const err = decodeProcessChunk(event.stderrBase64);
          if (err) {
            const text = stderrDecoder.decode(err, { stream: true });
            if (text) stderr.push(text);
          }
          if (event.exitCode !== undefined) exitCode = event.exitCode;
        }
        if (fed.endError) {
          endError = fed.endError;
          break;
        }
      }
      decoder.finish();
    } catch (error) {
      if (isAbort(error)) throw timeoutError(timeoutMs);
      throw error;
    } finally {
      try {
        await reader.cancel();
      } catch {
        // stream may already be closed
      }
    }
    stdout.push(stdoutDecoder.decode());
    stderr.push(stderrDecoder.decode());
    if (endError) {
      throw new Error(`DevBox EnvD process failed (${endError.code}): ${endError.message}`);
    }
    if (exitCode === undefined) {
      throw new Error('DevBox EnvD command stream ended without an exit status.');
    }
    return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode, pid };
  } finally {
    clearTimeout(timer);
  }
}

function filesUrl(envdUrl: string, path: string): string {
  if (!path.startsWith('/')) throw new Error('sandbox file path must be absolute.');
  const url = new URL('/files', `${envdUrl.replace(/\/$/, '')}/`);
  url.searchParams.set('path', path);
  return url.toString();
}

export async function writeDevboxFile(
  connection: DevboxConnectionRecord,
  remotePath: string,
  data: Uint8Array,
  timeoutMs = 120000,
): Promise<void> {
  const response = await devboxFetch(
    filesUrl(connection.envdUrl, remotePath),
    {
      method: 'POST',
      headers: { ...envdHeaders(connection), 'Content-Type': 'application/octet-stream' },
      body: data as unknown as BodyInit,
    },
    timeoutMs,
  );
  if (!response.ok) throw await responseError(response);
  await response.text();
}

export async function readDevboxFile(
  connection: DevboxConnectionRecord,
  remotePath: string,
  timeoutMs = 120000,
): Promise<Uint8Array> {
  const response = await devboxFetch(
    filesUrl(connection.envdUrl, remotePath),
    { method: 'GET', headers: envdHeaders(connection) },
    timeoutMs,
  );
  if (!response.ok) throw await responseError(response);
  return new Uint8Array(await response.arrayBuffer());
}

export async function statDevboxPath(
  connection: DevboxConnectionRecord,
  remotePath: string,
  timeoutMs = 30000,
): Promise<Record<string, unknown> | undefined> {
  const url = new URL('/filesystem.Filesystem/Stat', `${connection.envdUrl.replace(/\/$/, '')}/`).toString();
  const response = await devboxFetch(
    url,
    {
      method: 'POST',
      headers: {
        ...envdHeaders(connection),
        'Connect-Protocol-Version': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: remotePath }),
    },
    timeoutMs,
  );
  if (!response.ok) throw await responseError(response);
  const text = await response.text();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Client-side probe of the public app-port URL (no EnvD token needed).
 * Used by deploy_check and expose_tunnel on the devbox backend.
 */
export async function probeDevboxAppUrl(
  envdUrl: string,
  port: number,
  timeoutMs = 10000,
): Promise<{ url: string; status: number; ok: boolean }> {
  const url = devboxAppPortUrl(envdUrl, port);
  try {
    const response = await devboxFetch(url, { method: 'GET' }, timeoutMs);
    return { url, status: response.status, ok: response.status >= 200 && response.status < 400 };
  } catch {
    return { url, status: 0, ok: false };
  }
}

export function devboxAppPortUrl(envdUrl: string, port: number): string {
  // The test pool advertises a devbox-test host that does not resolve publicly;
  // the explicit DEVBOX_TEST_GATEWAY_HOST override makes the URL the developer
  // receives actually reachable. Production (no override) returns it unchanged.
  return rewriteDevboxUrl(deriveAppPortUrl(envdUrl, port));
}

/** Reads a whole local file as a Uint8Array (node:fs kept out of the wire module). */
export function bytesFromBuffer(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
