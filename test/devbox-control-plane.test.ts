import assert from 'node:assert/strict';
import test from 'node:test';

import { withTempAuthHome } from './hcloud-cli-harness.ts';
import { jsonResponse, stubFetch, withEnv } from './devbox-test-helpers.ts';
import {
  devboxConnect,
  devboxConnectTimeoutSeconds,
  devboxKill,
  devboxShutdown,
  devboxStatus,
  isDevboxAuthError,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-service-api.ts';

function withEnvCreds(fn: () => Promise<void>): Promise<void> {
  return withTempAuthHome(() =>
    withEnv(
      {
        HW_ACCESS_KEY: 'TESTAK',
        HW_SECRET_KEY: 'TESTSK',
        HW_SECURITY_TOKEN: 'TESTTOKEN',
        HDKITSERVICE_ENDPOINT: 'https://hdk.test/rest/developer/server/hdkitservice/',
      },
      fn,
    ),
  );
}

test('devboxConnect sends AK/SK + token, envVars, timeout and pool_type — no sandbox key', async () => {
  await withEnvCreds(async () => {
    const stub = stubFetch(() =>
      jsonResponse(200, {
        backend: 'devbox',
        sandbox_id: 'sb-1',
        session_id: 'sb-1',
        state: 'running',
        envd_url: 'https://t-49983.example.com',
        connect_token: 'ct',
        pool_type: 'ephemeral',
      }),
    );
    try {
      const result = await devboxConnect({
        timeoutSeconds: 600,
        envVars: { A: 'B' },
        poolType: 'ephemeral',
      });
      assert.equal(result.sandbox_id, 'sb-1');
      assert.equal(stub.calls.length, 1);
      const call = stub.calls[0]!;
      assert.match(call.url, /\/sandbox\/devbox\/connect$/);
      assert.equal(call.method, 'POST');
      assert.equal(call.headers['x-hw-ak'], 'TESTAK');
      assert.equal(call.headers['x-hw-sk'], 'TESTSK');
      assert.equal(call.headers['x-hw-security-token'], 'TESTTOKEN');
      const body = JSON.parse(call.body as string) as Record<string, unknown>;
      assert.equal(body.timeout, 600);
      assert.deepEqual(body.envVars, { A: 'B' });
      assert.equal(body.pool_type, 'ephemeral');
      assert.equal('git' in body, false, 'devbox create does not accept git');
      assert.equal(JSON.stringify(body).includes('sandbox_key'), false, 'there is no sandbox key');
    } finally {
      stub.restore();
    }
  });
});

test('devbox lifecycle calls use the control-plane verbs and paths', async () => {
  await withEnvCreds(async () => {
    const stub = stubFetch((captured) => {
      if (captured.method === 'DELETE') return jsonResponse(200, { ok: true, sandbox_id: 'sb-1', deleted: true });
      if (captured.url.endsWith('/shutdown')) {
        return jsonResponse(200, { ok: true, sandbox_id: 'sb-1', state: 'paused', pause_retention_hours: 168 });
      }
      return jsonResponse(200, { ok: true, sandbox_id: 'sb-1', state: 'running' });
    });
    try {
      const shutdown = await devboxShutdown('sb-1');
      assert.equal(shutdown.state, 'paused');
      const killed = await devboxKill('sb-1');
      assert.equal(killed.deleted, true);
      const status = await devboxStatus('sb-1');
      assert.equal(status.state, 'running');
      assert.equal(
        stub.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sandbox/devbox/sb-1')),
        true,
      );
    } finally {
      stub.restore();
    }
  });
});

test('control-plane credential codes surface unchanged (401 re-auth, 403 IAM, 502 upstream)', async () => {
  await withEnvCreds(async () => {
    for (const [status, code] of [
      [401, 'HDKIT_CREDENTIAL_INVALID'],
      [403, 'HDKIT_CREDENTIAL_FORBIDDEN'],
      [502, 'HDKIT_IAM_ERROR'],
    ] as const) {
      const stub = stubFetch(() => jsonResponse(status, { code, message: 'upstream says no' }));
      try {
        await assert.rejects(
          () => devboxConnect({ timeoutSeconds: 600 }),
          (error: unknown) => {
            const err = error as { code?: string; status?: number };
            assert.equal(err.code, code);
            assert.equal(err.status, status);
            return true;
          },
        );
      } finally {
        stub.restore();
      }
    }
  });
});

test('connect timeout env stays inside 10-86400 and rejects junk', () => {
  const previous = process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS;
  try {
    delete process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS;
    assert.equal(devboxConnectTimeoutSeconds(), 1800);
    process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS = '600';
    assert.equal(devboxConnectTimeoutSeconds(), 600);
    process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS = '5';
    assert.throws(() => devboxConnectTimeoutSeconds(), /between 10 and 86400/);
    process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS = 'nope';
    assert.throws(() => devboxConnectTimeoutSeconds(), /between 10 and 86400/);
  } finally {
    if (previous === undefined) delete process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS;
    else process.env.HW_SANDBOX_CONNECT_TIMEOUT_SECONDS = previous;
  }
});

test('isDevboxAuthError identifies 401/403 only', () => {
  assert.equal(isDevboxAuthError({ status: 401 }), true);
  assert.equal(isDevboxAuthError({ status: 403 }), true);
  assert.equal(isDevboxAuthError({ auth: true }), true);
  assert.equal(isDevboxAuthError({ status: 500 }), false);
  assert.equal(isDevboxAuthError(new Error('x')), false);
});
