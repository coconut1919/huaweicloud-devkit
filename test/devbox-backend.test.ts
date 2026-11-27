import assert from 'node:assert/strict';
import test from 'node:test';

import {
  _clearWorkspaceBackendsForTests,
  backendForWorkspace,
  forgetWorkspaceBackend,
  rememberWorkspaceBackend,
  sandboxBackend,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-backend.ts';
import {
  _clearDevboxConnectionsForTests,
  clearDevboxConnection,
  devboxTokenNeedsRefresh,
  getDevboxConnection,
  setDevboxConnectionFromResponse,
} from '../plugins/huaweicloud-core/src/sandbox/devbox/devbox-connections.ts';
import { enrichConnectResult } from '../plugins/huaweicloud-core/src/lib/hdkit/sandbox-pool.ts';

const ENV_KEY = 'HW_SANDBOX_BACKEND';

function withBackend(value: string | undefined, fn: () => void): void {
  const previous = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  }
}

test('unknown HW_SANDBOX_BACKEND values fail fast', () => {
  withBackend('devboxx', () => {
    assert.throws(() => sandboxBackend(), /must be "legacy" or "devbox"/);
  });
});

test('backend posture defaults to legacy and pins per workspace', () => {
  withBackend(undefined, () => {
    _clearWorkspaceBackendsForTests();
    assert.equal(sandboxBackend(), 'legacy');
    rememberWorkspaceBackend('ws-legacy', 'legacy');
    process.env[ENV_KEY] = 'devbox';
    assert.equal(backendForWorkspace('ws-legacy'), 'legacy', 'the pinned workspace must not follow the env flip');
    assert.equal(backendForWorkspace('ws-unknown'), 'devbox', 'unpinned workspaces follow the current posture');
    forgetWorkspaceBackend('ws-legacy');
    assert.equal(backendForWorkspace('ws-legacy'), 'devbox');
    _clearWorkspaceBackendsForTests();
  });
});

test('devbox connection cache keeps tokens in memory and aliases the sandbox id', () => {
  _clearDevboxConnectionsForTests();
  const record = setDevboxConnectionFromResponse('ws-1', {
    backend: 'devbox',
    sandbox_id: 'sb-1',
    session_id: 'sb-1',
    state: 'running',
    envd_url: 'https://t-49983.example.com',
    connect_token: 'ct-1',
    envd_access_token: 'eat-1',
    token_expiration: new Date(Date.now() + 3600_000).toISOString(),
    pool_type: 'ephemeral',
    started: false,
  });
  assert.equal(record.sandboxId, 'sb-1');
  assert.equal(getDevboxConnection('ws-1')?.connectToken, 'ct-1');
  assert.equal(getDevboxConnection('sb-1')?.connectToken, 'ct-1', 'the sandbox id aliases the same cache entry');

  clearDevboxConnection('sb-1');
  assert.equal(getDevboxConnection('ws-1'), undefined, 'clearing via either id clears both aliases');
  _clearDevboxConnectionsForTests();
});

test('partial connect responses are refused rather than half-cached', () => {
  assert.throws(
    () => setDevboxConnectionFromResponse('ws-partial', { state: 'running' }),
    /did not include a sandbox id/,
  );
  assert.throws(
    () =>
      setDevboxConnectionFromResponse('ws-partial', {
        sandbox_id: 'sb-1',
        envd_url: 'https://x-49983.example.com',
      }),
    /did not include EnvD credentials/,
  );
});

test('token refresh window is five minutes', () => {
  const soon = setDevboxConnectionFromResponse('ws-soon', {
    sandbox_id: 'sb-soon',
    envd_url: 'https://x-49983.example.com',
    connect_token: 'ct',
    token_expiration: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(devboxTokenNeedsRefresh(soon), true);

  const later = setDevboxConnectionFromResponse('ws-later', {
    sandbox_id: 'sb-later',
    envd_url: 'https://x-49983.example.com',
    connect_token: 'ct',
    token_expiration: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert.equal(devboxTokenNeedsRefresh(later), false);

  const epoch = setDevboxConnectionFromResponse('ws-epoch', {
    sandbox_id: 'sb-epoch',
    envd_url: 'https://x-49983.example.com',
    connect_token: 'ct',
    token_expiration: String(Math.floor(Date.now() / 1000) + 60),
  });
  assert.equal(devboxTokenNeedsRefresh(epoch), true);
  _clearDevboxConnectionsForTests();
});

test('devbox connect enrichment announces sandbox TTL/pause retention, not legacy idle numbers', () => {
  const enriched = enrichConnectResult(
    {
      backend: 'devbox',
      pool_type: 'ephemeral',
      state: 'running',
      end_at: '2026-11-26T16:00:00Z',
      token_expiration: '2026-11-27T15:00:00Z',
      pause_retention_hours: 168,
    },
    { announce: true },
  ) as Record<string, unknown>;
  const pool = enriched.pool as { pool_type: string; lifecycle: string; ttl_hint: string };
  assert.equal(pool.pool_type, 'ephemeral');
  assert.match(pool.lifecycle, /devbox ephemeral sandbox/);
  assert.match(pool.ttl_hint, /2026-11-26T16:00:00Z/);
  assert.match(pool.ttl_hint, /168 小时/);
  assert.doesNotMatch(pool.ttl_hint, /30min|闲置 1h|自动删除/);
});
