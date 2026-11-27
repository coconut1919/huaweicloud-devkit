// The ONLY devbox module allowed to touch undici. The normal path rides
// fetchWithProxy (system proxy posture); the test-only TLS/DNS switches build
// a dedicated undici Agent. Production defaults stay strict TLS + real DNS.

import { fetchWithProxy } from '../../proxy/proxy-agent.ts';
import { isDevboxBackend } from './devbox-backend.ts';

export interface DevboxResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type UndiciModule = typeof import('undici');
type Dispatcher = import('undici').Dispatcher;

let testDispatcher: Dispatcher | undefined;
let testDispatcherKey = '';
let insecureWarningEmitted = false;

function testOverridesActive(): boolean {
  if (!isDevboxBackend()) return false;
  return (
    process.env.DEVBOX_TLS_INSECURE === '1' ||
    Boolean(process.env.DEVBOX_TEST_GATEWAY_HOST) ||
    Boolean(process.env.DEVBOX_TEST_GATEWAY_IP)
  );
}

const NODE_UNDICI_SPECIFIER = 'node:undici';

async function importUndici(): Promise<UndiciModule> {
  try {
    // Node exposes the bundled client as `node:undici`; fall back to the npm package.
    return (await import(NODE_UNDICI_SPECIFIER)) as UndiciModule;
  } catch {
    return await import('undici');
  }
}

/**
 * Test gateway rewrite (explicit env only): the test pool advertises a
 * `devbox-test.hwtunnel.com` host that does not resolve publicly; keep the
 * tunnel-id label and swap the gateway suffix.
 */
export function rewriteDevboxUrl(raw: string): string {
  const testHost = process.env.DEVBOX_TEST_GATEWAY_HOST;
  if (!testOverridesActive() || !testHost) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname.endsWith(`.${testHost}`) || url.hostname === testHost) return raw;
  const label = url.hostname.split('.')[0];
  if (label) url.hostname = `${label}.${testHost}`;
  return url.toString();
}

async function getTestDispatcher(): Promise<Dispatcher | undefined> {
  if (!testOverridesActive()) return undefined;
  const tlsInsecure = process.env.DEVBOX_TLS_INSECURE === '1';
  const testHost = process.env.DEVBOX_TEST_GATEWAY_HOST ?? '';
  const testIp = process.env.DEVBOX_TEST_GATEWAY_IP ?? '';
  const key = `${tlsInsecure ? '1' : '0'}|${testHost}|${testIp}`;
  if (testDispatcher && testDispatcherKey === key) return testDispatcher;
  const { Agent } = await importUndici();
  const connectOptions: Record<string, unknown> = { rejectUnauthorized: !tlsInsecure };
  if (testIp) {
    const dns = await import('node:dns');
    type LookupCallback = (
      err: NodeJS.ErrnoException | null,
      address?: string | ReadonlyArray<{ address: string; family: number }>,
      family?: number,
    ) => void;
    connectOptions.lookup = (hostname: string, options: { all?: boolean } | number, callback: LookupCallback) => {
      const wantsAll = typeof options === 'object' && options !== null && options.all === true;
      if (testHost && hostname.endsWith(`.${testHost}`)) {
        if (wantsAll) return callback(null, [{ address: testIp, family: 4 }]);
        return callback(null, testIp, 4);
      }
      return (dns.lookup as unknown as (host: string, opts: unknown, cb: LookupCallback) => void)(
        hostname,
        options,
        callback,
      );
    };
  }
  testDispatcher = new Agent({ connect: connectOptions });
  testDispatcherKey = key;
  if (!insecureWarningEmitted && (tlsInsecure || testHost || testIp)) {
    insecureWarningEmitted = true;
    console.warn(
      '[devbox] TEST-only transport overrides active (DEVBOX_TLS_INSECURE / DEVBOX_TEST_GATEWAY_*). ' +
        'Never set these in production.',
    );
  }
  return testDispatcher;
}

/** DevBox data/API fetch: proxy-aware in production, explicit test Agent otherwise. */
export async function devboxFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<DevboxResponseLike> {
  const rewritten = rewriteDevboxUrl(url);
  const signal =
    timeoutMs !== undefined
      ? init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
      : init.signal;
  const merged: RequestInit = signal ? { ...init, signal } : init;
  const dispatcher = await getTestDispatcher();
  if (!dispatcher) {
    return (await fetchWithProxy(rewritten, merged)) as unknown as DevboxResponseLike;
  }
  const { fetch: undiciFetch } = await importUndici();
  const response = await undiciFetch(rewritten, {
    ...merged,
    dispatcher,
  } as unknown as Parameters<typeof undiciFetch>[1]);
  return response as unknown as DevboxResponseLike;
}

export async function closeDevboxTestDispatcher(): Promise<void> {
  if (testDispatcher) {
    try {
      await (testDispatcher as { close(): Promise<void> }).close();
    } catch {
      // best-effort test cleanup
    }
  }
  testDispatcher = undefined;
  testDispatcherKey = '';
  insecureWarningEmitted = false;
}
