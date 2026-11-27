// Shared devbox test fixtures: the global-fetch capture seam, the Connect
// frame response builder, and an env save/restore wrapper. Kept out of the
// test files so the protocol/control-plane/exec suites share one copy.

import { Buffer } from 'node:buffer';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function stubFetch(handler: (captured: CapturedRequest) => Response): {
  calls: CapturedRequest[];
  restore: () => void;
} {
  const original = global.fetch;
  const calls: CapturedRequest[] = [];
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const captured: CapturedRequest = {
      url: String(typeof input === 'string' ? input : ((input as { url?: string }).url ?? input)),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])),
      body: init?.body,
    };
    calls.push(captured);
    return handler(captured);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

export function frame(value: unknown, flags = 0): Uint8Array {
  const body = Buffer.from(JSON.stringify(value));
  const out = Buffer.alloc(5 + body.length);
  out.writeUInt8(flags, 0);
  out.writeUInt32BE(body.length, 1);
  body.copy(out, 5);
  return out;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function execStream(stdout: string, exitCode = 0): Response {
  const stream = Buffer.concat([
    frame({ event: { start: { pid: 42 } } }),
    frame({ event: { data: { stdout: Buffer.from(stdout).toString('base64') } } }),
    frame({ event: { end: { exitCode } } }),
    frame({}, 0x02),
  ]);
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/connect+json' },
  });
}

/** Saves/restores the named env vars (undefined means delete), then runs fn. */
export async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
