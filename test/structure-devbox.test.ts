import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { pluginRoot } from './structure-helpers.ts';

const srcRoot = join(pluginRoot, 'src');
const devboxRoot = join(srcRoot, 'sandbox', 'devbox');
const skillPath = join(srcRoot, 'packs', 'sandbox', 'skills', 'huawei-sandbox', 'SKILL.md');
const toolsPath = join(srcRoot, 'packs', 'sandbox', 'tools.ts');

function read(relative: string): string {
  return readFileSync(join(srcRoot, relative), 'utf8');
}

test('devbox v1 has no persistent PTY/Connect/SendInput/SendSignal dependency', () => {
  const files = readdirSync(devboxRoot).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length >= 7, 'the devbox module family must exist');
  for (const file of files) {
    const raw = readFileSync(join(devboxRoot, file), 'utf8');
    // The v1 scope is one-shot only; comments may DISCUSS the excluded surface,
    // but no code path may call or expose it.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['Process/Connect', 'SendInput', 'SendSignal', 'pty.start', 'hwlink']) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${file} must not carry the excluded PTY/session surface (${forbidden})`,
      );
    }
  }
});

test('devbox modules do not derive layout dirs by depth (bundle flattening guard)', () => {
  for (const file of readdirSync(devboxRoot).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(join(devboxRoot, file), 'utf8');
    assert.equal(text.includes('import.meta.url'), false, `${file} must not derive paths from import.meta.url`);
    assert.equal(text.includes('__dirname'), false, `${file} must not derive paths from __dirname`);
  }
});

test('devbox-envd-transport is the only devbox module importing undici', () => {
  for (const file of readdirSync(devboxRoot).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(join(devboxRoot, file), 'utf8');
    const importsUndici = /(?:from|import)\s*\(?\s*['"](?:node:)?undici['"]/.test(text);
    if (file === 'devbox-envd-transport.ts') {
      assert.ok(importsUndici, 'the transport module owns the undici seam');
    } else {
      assert.equal(importsUndici, false, `${file} must not import undici directly`);
    }
  }
});

test('devbox v1 has no sandbox key surface', () => {
  for (const file of readdirSync(devboxRoot).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(join(devboxRoot, file), 'utf8');
    assert.equal(
      /X-Sandbox-Key|sandboxKey|crypto\.randomBytes/.test(text),
      false,
      `${file} must not implement a sandbox key`,
    );
  }
});

test('control plane talks to the /sandbox/devbox namespace with the shared hdkitRequest seam', () => {
  const api = read('sandbox/devbox/devbox-service-api.ts');
  assert.match(api, /from '\.\.\/\.\.\/lib\/hdkit\/hdkitservice-api\.ts'/);
  assert.match(api, /sandbox\/devbox\/connect/);
  assert.match(api, /sandbox\/devbox\/\$\{encodeURIComponent\(sandboxId\)\}\/connect/);
  assert.match(api, /sandbox\/devbox\/\$\{encodeURIComponent\(sandboxId\)\}\/shutdown/);
  assert.match(api, /hdkitRequest\('DELETE'/);
  assert.match(api, /devboxTokenNeedsRefresh/);
});

test('the sandbox skill and tool descriptions teach the devbox divergences', () => {
  const skill = readFileSync(skillPath, 'utf8');
  assert.match(skill, /^## DevBox backend \(HW_SANDBOX_BACKEND=devbox\)$/m);
  assert.match(skill, /degraded:true`, `statePersisted:false/);
  assert.match(skill, /setsid nohup <serve-command>/);
  assert.match(skill, /MUST bind `0\.0\.0\.0`/);
  assert.match(skill, /`kill` confirms on every call and is devbox-only/);

  const tools = readFileSync(toolsPath, 'utf8');
  const execWithSession = tools.slice(tools.indexOf("name: 'huaweicloud_sandbox_exec_with_session'"));
  const execBlock = execWithSession.slice(0, execWithSession.indexOf('schema'));
  assert.match(execBlock, /devbox backend: DEGRADED to one-shot/);
  assert.match(execBlock, /statePersisted:false/);
  const kill = tools.slice(tools.indexOf("name: 'huaweicloud_sandbox_kill'"));
  assert.match(kill.slice(0, kill.indexOf('schema')), /devbox-only/);
});

test('the devbox reference document exists and is linked from the skill', () => {
  const reference = join(
    pluginRoot,
    'src',
    'packs',
    'sandbox',
    'skills',
    'huawei-sandbox',
    'references',
    'devbox-backend.md',
  );
  assert.ok(existsSync(reference), 'references/devbox-backend.md must exist');
  const skill = readFileSync(skillPath, 'utf8');
  assert.match(skill, /\[DevBox backend\]\(references\/devbox-backend\.md\)/);
});
