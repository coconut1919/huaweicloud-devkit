import { execWithSession, execOneShot, closeSession, getCurrentWorkspaceId } from '../../sandbox/session-manager.ts';
import { backendForWorkspace } from '../../sandbox/devbox/devbox-backend.ts';
import { forgetWorkspacePool } from '../../lib/hdkit/sandbox-pool.ts';
import type { CallToolOptions, ToolArgs } from '../../tools.ts';
import { SANDBOX_TIMEOUT_MS } from './schemas.ts';
import { startHwexecTask } from './handlers-hwexec.ts';

// Session/exec handlers for the sandbox pack, extracted verbatim from
// tools.ts in the within-pack split for the jscpd complex-file bar; the
// tools.ts face imports them for SANDBOX_TOOL_HANDLERS. The exec_one_shot
// async branch (mode: "async", the claim protocol) delegates to
// handlers-hwexec.ts — the poll tool handler lives there whole.

export async function handleExecWithSession(args: ToolArgs = {}, _opts: CallToolOptions = {}) {
  const sandboxWsId2 = args.workspace_id || getCurrentWorkspaceId();
  if (!sandboxWsId2) {
    throw new Error(
      'workspace_id is required. No sandbox connected — call huaweicloud_sandbox_connect first, ' +
        'or set HW_WORKSPACE_ID environment variable before starting the agent.',
    );
  }
  const sandboxUser2 = args.username || 'root';
  const sandboxTimeout2 = args.timeout_ms || SANDBOX_TIMEOUT_MS.exec_with_session;
  const sandboxResult2 = await execWithSession(sandboxWsId2, args.command || '', sandboxUser2, sandboxTimeout2);
  if (backendForWorkspace(sandboxWsId2) === 'devbox') {
    return {
      stdout: sandboxResult2.stdout,
      exitCode: sandboxResult2.exitCode,
      backend: 'devbox',
      degraded: true,
      statePersisted: false,
      hint:
        'devbox 后端不保留 shell 状态：本次只是 one-shot 执行，cd/env/变量不会跨调用。' +
        '命令必须自包含（cd ... && ...、source ...; ...），需要跨调用状态请使用 legacy 后端。',
    };
  }
  return {
    stdout: sandboxResult2.stdout,
    exitCode: sandboxResult2.exitCode,
  };
}

export async function handleExecOneShot(args: ToolArgs = {}, _opts: CallToolOptions = {}) {
  const sandboxWsId3 = args.workspace_id || getCurrentWorkspaceId();
  if (!sandboxWsId3) {
    throw new Error(
      'workspace_id is required. No sandbox connected — call huaweicloud_sandbox_connect first, ' +
        'or set HW_WORKSPACE_ID environment variable before starting the agent.',
    );
  }
  const sandboxUser3 = args.username || 'root';
  // mode: "async" routes into the claim protocol (claim + detached spawn +
  // receipt, then huaweicloud_sandbox_exec_poll); every other mode value
  // (the default sync, or a direct callTool caller's omission) runs the
  // synchronous exec below unchanged.
  if (args.mode === 'async') {
    return startHwexecTask(args, sandboxWsId3, sandboxUser3);
  }
  const sandboxTimeout3 = args.timeout_ms || SANDBOX_TIMEOUT_MS.exec_one_shot;
  const sandboxResult3 = await execOneShot(sandboxWsId3, args.command || '', sandboxUser3, sandboxTimeout3);
  return {
    stdout: sandboxResult3.stdout,
    exitCode: sandboxResult3.exitCode,
  };
}

export async function handleCloseSession(args: ToolArgs = {}, _opts: CallToolOptions = {}) {
  const sandboxWsId4 = args.workspace_id || getCurrentWorkspaceId();
  if (!sandboxWsId4) {
    throw new Error(
      'workspace_id is required. No sandbox connected — call huaweicloud_sandbox_connect first, ' +
        'or set HW_WORKSPACE_ID environment variable before starting the agent.',
    );
  }
  if (backendForWorkspace(sandboxWsId4) === 'devbox') {
    // Devbox v1 has no terminal session to close; the sandbox itself is NOT
    // deleted (use shutdown/kill for lifecycle control).
    return {
      ok: true,
      backend: 'devbox',
      not_applicable: true,
      message: 'close_session is not applicable on devbox (no terminal session exists); the sandbox is left untouched.',
    };
  }
  const sandboxUser4 = args.username || 'root';
  const closed = await closeSession(sandboxWsId4, sandboxUser4);
  if (closed) {
    // 池归属缓存随会话关闭清理：长驻进程防只增不减/陈旧池归属
    forgetWorkspacePool(sandboxWsId4);
  }
  return closed ? 'ok' : 'not_connected';
}
