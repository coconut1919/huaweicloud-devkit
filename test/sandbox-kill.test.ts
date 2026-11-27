import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { pluginRoot } from './structure-helpers.ts';
import {
  SANDBOX_TOOL_HANDLERS,
  SANDBOX_TOOLS,
  SANDBOX_TOOL_SCHEMAS,
} from '../plugins/huaweicloud-core/src/packs/sandbox/tools.ts';
import { APPROVAL_SPECS } from '../plugins/huaweicloud-core/src/packs/registry.ts';
import { APPROVAL_TOOLS, APPROVAL_TOOL_INPUT_SHAPES } from '../plugins/huaweicloud-core/src/approval-roster.ts';
import { PER_PACK_TOOLS } from './plugins-e2e-roster.ts';

const KILL = 'huaweicloud_sandbox_kill';

test('kill registers a schema, handler, and pack ownership row', () => {
  assert.ok(SANDBOX_TOOLS.some((tool) => tool.name === KILL));
  assert.equal(typeof SANDBOX_TOOL_SCHEMAS[KILL], 'object');
  assert.equal(typeof SANDBOX_TOOL_HANDLERS[KILL], 'function');
  const parsed = SANDBOX_TOOL_SCHEMAS[KILL]!.parse({ dev_stage_id: 'sb-1' }) as Record<string, unknown>;
  assert.equal(parsed.dev_stage_id, 'sb-1');
});

test('kill joins the approval roster as a structured, always-flavor lifecycle face', () => {
  assert.ok((APPROVAL_TOOLS as readonly string[]).includes(KILL));
  assert.equal((APPROVAL_TOOL_INPUT_SHAPES as Record<string, string>)[KILL], 'structured');
  const spec = (APPROVAL_SPECS as Record<string, { flavor?: string; domain?: string }>)[KILL];
  assert.ok(spec, 'kill must carry an ApprovalSpec (the gate resolves specs by name)');
  assert.equal(spec.flavor, 'always', 'kill is irreversible — no content rule may exempt it');
  assert.equal(spec.domain, 'sandbox');
});

test('safety policy lists kill as a sandbox write tool', () => {
  const policy = JSON.parse(readFileSync(join(pluginRoot, 'safety', 'policy.json'), 'utf8')) as {
    sandboxWriteTools?: string[];
  };
  assert.ok(policy.sandboxWriteTools?.includes(KILL), 'policy.json sandboxWriteTools must list kill');
});

test('the e2e roster and the committed .mcp.json carry kill', () => {
  assert.ok((PER_PACK_TOOLS as Record<string, readonly string[]>).sandbox.includes(KILL));
  const mcp = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf8')) as {
    mcpServers: Record<string, { tools?: Record<string, { approval_mode?: string }> }>;
  };
  const tools = mcp.mcpServers['huaweicloud-devkit']?.tools ?? {};
  assert.equal(tools[KILL]?.approval_mode, 'approve');
});
