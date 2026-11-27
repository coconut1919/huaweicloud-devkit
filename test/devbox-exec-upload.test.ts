import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  execDevboxOneShot,
  readDevboxFile,
  writeDevboxFile,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-envd-client.ts';
import {
  _clearDevboxConnectionsForTests,
  setDevboxConnectionFromResponse,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-connections.ts';
import { withDevboxConnection } from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-service-api.ts';
import { withTempAuthHome } from './hcloud-cli-harness.ts';
import { execStream, stubFetch, withEnv } from './devbox-test-helpers.ts';

function connection(overrides: Record<string, unknown> = {}) {
  return setDevboxConnectionFromResponse('sb-1', {
    backend: 'devbox',
    sandbox_id: 'sb-1',
    envd_url: 'https://tunnel-49983.example.com',
    connect_token: 'ct-old',
    envd_access_token: 'eat-old',
    token_expiration: new Date(Date.now() + 3600_000).toISOString(),
    state: 'running',
    pool_type: 'ephemeral',
    ...overrides,
  });
}

test('execDevboxOneShot sends the EnvD headers and a one-shot Process/Start frame', async () => {
  const conn = connection();
  const stub = stubFetch(() => execStream('hello\n'));
  try {
    const result = await execDevboxOneShot(conn, "cd /tmp && printf 'hello\\n'", 10000);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'hello\n');
    assert.equal(result.pid, 42);
    const call = stub.calls[0]!;
    assert.match(call.url, /\/process\.Process\/Start$/);
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['cookie'], 'relay_token=ct-old');
    assert.equal(call.headers['x-access-token'], 'eat-old');
    assert.equal(call.headers['e2b-sandbox-id'], 'sb-1');
    assert.equal(call.headers['e2b-sandbox-port'], '49983');
    assert.equal(call.headers['connect-protocol-version'], '1');
    assert.equal(call.headers['content-type'], 'application/connect+json');
    const bytes = call.body as Uint8Array;
    const length = new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(0);
    const payload = JSON.parse(Buffer.from(bytes.subarray(5, 5 + length)).toString('utf8')) as {
      process: { cmd: string; args: string[] };
      stdin: boolean;
    };
    assert.equal(payload.process.cmd, '/bin/bash');
    assert.deepEqual(payload.process.args, ['-l', '-c', "cd /tmp && printf 'hello\\n'"]);
    assert.equal(payload.stdin, false);
  } finally {
    stub.restore();
    _clearDevboxConnectionsForTests();
  }
});

test('a data-plane 401 refreshes via hdkitservice once and retries with the new token', async () => {
  await withTempAuthHome(async () => {
    await withEnv(
      {
        HW_ACCESS_KEY: 'TESTAK',
        HW_SECRET_KEY: 'TESTSK',
        HDKITSERVICE_ENDPOINT: 'https://hdk.test/rest/developer/server/hdkitservice/',
      },
      async () => {
        connection();
        let processCalls = 0;
        const stub = stubFetch((captured) => {
          if (captured.url.includes('/process.Process/Start')) {
            processCalls += 1;
            if (captured.headers['cookie'] === 'relay_token=ct-refreshed') return execStream('after-refresh\n');
            return new Response(JSON.stringify({ code: 'unauthenticated', message: 'token expired' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (captured.url.includes('/sandbox/devbox/sb-1/connect')) {
            return new Response(
              JSON.stringify({
                backend: 'devbox',
                sandbox_id: 'sb-1',
                state: 'running',
                envd_url: 'https://tunnel-49983.example.com',
                connect_token: 'ct-refreshed',
                envd_access_token: 'eat-refreshed',
                token_expiration: new Date(Date.now() + 3600_000).toISOString(),
                pool_type: 'ephemeral',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          throw new Error(`unexpected url ${captured.url}`);
        });
        try {
          const result = await withDevboxConnection('sb-1', (conn) => execDevboxOneShot(conn, 'true', 10000));
          assert.equal(result.stdout, 'after-refresh\n');
          assert.equal(processCalls, 2, 'the operation retries exactly once after the refresh');
          const processRequests = stub.calls.filter((call) => call.url.includes('/process.Process/Start'));
          assert.equal(processRequests[1]!.headers['cookie'], 'relay_token=ct-refreshed');
        } finally {
          stub.restore();
          _clearDevboxConnectionsForTests();
        }
      },
    );
  });
});

test('writeDevboxFile posts bytes to /files and readDevboxFile gets them back', async () => {
  const conn = connection();
  const payload = new Uint8Array([1, 2, 3, 4]);
  const stub = stubFetch((captured) => {
    if (captured.method === 'POST') {
      return new Response(JSON.stringify({ files: [{ path: '/tmp/a.bin' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(payload, { status: 200 });
  });
  try {
    await writeDevboxFile(conn, '/tmp/a.bin', payload, 5000);
    const write = stub.calls[0]!;
    assert.match(write.url, /\/files\?path=%2Ftmp%2Fa\.bin$/);
    assert.equal(write.headers['content-type'], 'application/octet-stream');
    assert.deepEqual(new Uint8Array(write.body as Uint8Array), payload);

    const read = await readDevboxFile(conn, '/tmp/a.bin', 5000);
    assert.deepEqual(read, payload);
  } finally {
    stub.restore();
    _clearDevboxConnectionsForTests();
  }
});
