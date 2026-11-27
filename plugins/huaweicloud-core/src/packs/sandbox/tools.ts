import {
  execWithSessionSchema,
  execOneShotSchema,
  execPollSchema,
  closeSessionSchema,
  uploadFileSchema,
  uploadProjectSchema,
  deployNginxSchema,
  deployCheckSchema,
  checkUserSchema,
  exposeTunnelSchema,
  exposePollSchema,
  renewTunnelSchema,
  keepaliveWatchdogSchema,
  signAgreementSchema,
  connectSchema,
  credentialsSchema,
  shutdownSchema,
  killSchema,
} from './schemas.ts';
import { handleExecWithSession, handleExecOneShot, handleCloseSession } from './handlers-session.ts';
import { handleHwexecPoll } from './handlers-hwexec.ts';
import { handleUploadFile, handleUploadProject } from './handlers-upload.ts';
import { handleDeployNginx, handleDeployCheck } from './handlers-deploy.ts';
import { handleExposeTunnel, handleExposePoll, handleRenewTunnel, handleKeepaliveWatchdog } from './handlers-tunnel.ts';
import { handleCheckUser, handleSignAgreement, handleConnect, handleShutdown, handleKill } from './handlers-account.ts';
import { handleCredentials } from './handlers-credentials.ts';
import type { PackToolDefinition, LooseToolSchema } from '../../lib/pack-types.ts';

// The sandbox pack's stable face (split from the former 879-line monolith
// for the jscpd complex-file bar, cx < 50 per file; the safety-policy.ts
// precedent — same exported names, same import path, same behavior). It
// holds the SANDBOX_TOOLS / SANDBOX_TOOL_SCHEMAS / SANDBOX_TOOL_HANDLERS
// arrays and their satisfies compile-time completeness checks, and
// re-exports SANDBOX_TIMEOUT_MS; registry.ts, pack.ts, tool-definitions.ts,
// tool-schemas.ts, and the tests keep importing exactly these names from
// here. The family behind it (all siblings inside src/packs/sandbox/,
// joining the pack-boundaries walk automatically): schemas.ts (the zod
// schema block + the timeout table), git-transfer.ts (the repo transfer
// trio), handlers-session.ts / handlers-hwexec.ts / handlers-upload.ts /
// handlers-deploy.ts / handlers-tunnel.ts / handlers-account.ts /
// handlers-credentials.ts (the tool handlers, migrated verbatim from
// src/tools.ts with the P2 pack program; handlers-hwexec.ts carries the
// async-exec claim protocol — the exec_one_shot async branch and the
// exec_poll tool).

export { SANDBOX_TIMEOUT_MS } from './schemas.ts';

export const SANDBOX_TOOLS = [
  {
    name: 'huaweicloud_sandbox_exec_with_session',
    description:
      'Execute a command on a workspace terminal. Legacy (DevStation) backend: session reuse — shell state (cd, env vars, aliases) persists across calls; use for interactive work and command sequences that need shared state. devbox backend: DEGRADED to one-shot — the command runs once through EnvD Process/Start (non-PTY) with no shell state, and the response carries degraded:true / statePersisted:false; commands must be self-contained (cd ... && ..., source ...; ...). On devbox prefer huaweicloud_sandbox_exec_one_shot. NOT for long-running commands (>30s) — use exec_one_shot with mode:"async".',
    schema: execWithSessionSchema,
    handler: handleExecWithSession,
  },
  {
    name: 'huaweicloud_sandbox_exec_one_shot',
    description:
      'Execute a command on a workspace terminal with a fresh connection per call (no session state carries over). Each invocation opens a new WebSocket connection, executes one command, then disconnects. devbox backend: runs through EnvD Process/Start (non-PTY, /bin/bash -l -c <command>) and reads the end event; the async claim protocol below is unchanged. Use for long-running build/deploy/install commands (>30s) that do not need shell state persistence between calls. More stable than session-based execution for heavy workloads. Commands that can outlive the sync timeout (default 120s) must run in mode: "async" instead: the tool claims a per-task directory with an atomic O_EXCL claim, spawns the command detached (setsid/nohup/disown — it survives the exec session), and returns immediately with {started, taskId, taskDir}; poll the verdict with huaweicloud_sandbox_exec_poll — that async + poll pair is the >30s long-command doctrine, and the same-task_id retry after started:"uncertain" is structurally double-spawn-safe. started:"dup" + verdict "never" → start over with a NEW task_id.',
    schema: execOneShotSchema,
    handler: handleExecOneShot,
  },
  {
    name: 'huaweicloud_sandbox_exec_poll',
    description:
      'Poll an async sandbox task started by huaweicloud_sandbox_exec_one_shot with mode: "async". One call runs a bounded server-side wait (wait_ms 0-60000: sleep-2 intervals checking the task\'s status file; the exec timeout auto-folds to wait_ms + 15s so the wait always fits), then returns the task\'s verdict as a discriminated union — done (exitCode + logTail: the command finished), running (logTail: keep polling), lost (the wrapper died without an exit status, or the task directory vanished — a sandbox reboot — while this process remembered the task; restart with a new task_id if needed), never (the task was claimed but never launched — the start exec died between claim and spawn; start a NEW task_id, a same-id retry can never spawn), unknown (no task directory and no memory of the task_id — it never started here, or both the sandbox and this agent restarted). logTail is the last tail_bytes (default 4096) of the task\'s captured stdout+stderr. The retry ladder: started:"uncertain" → retry the SAME task_id (the claim file blocks a second copy); started:"dup" + verdict "never" → new task_id.',
    schema: execPollSchema,
    handler: handleHwexecPoll,
  },
  {
    name: 'huaweicloud_sandbox_close_session',
    description:
      'Close the persistent terminal session for a workspace. This closes the agent-side terminal session only — it does NOT delete the sandbox instance. Resource-pool sandbox deletion is developer-initiated (always ask for a second confirmation before guiding a delete) or handled by the platform resource-group idle-reclaim policy within the 7-day cap (v3 caliber); devkit never defers or performs deletion on the user behalf. devbox backend: there is no terminal session to close — returns backend:"devbox", not_applicable:true and leaves the sandbox untouched (use shutdown to pause / kill to delete).',
    schema: closeSessionSchema,
    handler: handleCloseSession,
  },
  {
    name: 'huaweicloud_sandbox_upload_file',
    description:
      'Upload a local file into the sandbox workspace. Legacy backend: base64-encodes the file, writes it in small chunks through the terminal session (the exec channel is fragile for large single commands), then decodes and verifies the md5 checksum. devbox backend: binary write through EnvD /files plus an md5 check (no terminal session, no base64 chunking). The remote parent directory is created automatically if absent. Use this instead of embedding large file content directly in a command. local_path must be readable from the machine running the DevKit MCP server — if the file lives elsewhere, copy it to the local temp directory first.',
    schema: uploadFileSchema,
    handler: handleUploadFile,
  },
  {
    name: 'huaweicloud_sandbox_upload_project',
    description:
      'Package a local project directory and upload it to a sandbox workspace. Creates a tar.gz archive, uploads it, and extracts it on the sandbox by default. Legacy backend: uploads via HTTP tunnel. devbox backend: writes the archive through EnvD /files and extracts it with tar inside the sandbox (no HTTP tunnel, no file server). local_dir must be readable from the machine running the DevKit MCP server — if the project lives elsewhere, copy it to the local temp directory first.',
    schema: uploadProjectSchema,
    handler: handleUploadProject,
  },
  {
    name: 'huaweicloud_sandbox_deploy_nginx',
    description:
      'Deploy an nginx configuration on the sandbox and reload. devbox backend: no DevBridge probe; a successful deploy returns backend:"devbox", previewUrl (the app-port URL) and nextStep:"deploy_check". Takes nginxType, port, project, outputDir from framework detection and writes the correct template (SPA try_files, SSR reverse proxy, or static). Also fixes directory traverse permissions on the project path. Use this instead of manually constructing nginx config — it handles permissions, template selection, and reload in one call. If the requested port is already in use, the actual port is auto-incremented and returned in "port" alongside a warning.',
    schema: deployNginxSchema,
    handler: handleDeployNginx,
  },
  {
    name: 'huaweicloud_sandbox_deploy_check',
    description:
      'Run a deployment completeness check on the sandbox. Verifies nginx is serving, output directory exists, DevBridge tunnel is active and accessible, and QR code exists (cross-platform). devbox backend: checks nginx/output/fingerprint inside the sandbox and probes the public app-port URL from the devkit side — there is no DevBridge tunnel check; nextStep is expose_tunnel when the app URL is unreachable. Returns a score, nextStep, and (when the DevBridge tunnel is missing) an executable "remediation" command string. Call this at the end of a deployment workflow to confirm everything is working before reporting success.',
    schema: deployCheckSchema,
    handler: handleDeployCheck,
  },
  {
    name: 'huaweicloud_sandbox_expose_tunnel',
    description:
      'Expose a port on the sandbox to a public URL. devbox backend: no DevBridge tunnel — returns the public app-port URL synchronously (backend:"devbox", publicUrl/url, accessible); single port and the app must bind 0.0.0.0 (a 127.0.0.1-only app is unreachable); expose_poll/renew_tunnel/keepalive_watchdog are not applicable. Legacy backend: public DevBridge tunnel URL (devbridge 0.2.x). Authenticates automatically (DevBridge auth is fixed to API Key — AK/SK login removed: the waterfall reads the sandbox keyring, then the /tmp/hw_api_key file channel; when both are empty it auto-creates the per-account × per-pool key (devkit-ephemeral/devkit-persistent) via the DevStation relay API and injects it, reporting authMode API_KEY_AUTO), selectively cleans only same-port/orphan tunnels before exposing (cleanup_mode=stale default — other ports, other sessions and keepalive-protected tunnels are preserved, except a tunnel bound to THIS port, which is always replaced; on 10006 quota it removes orphans first, then the oldest non-keepalive tunnel one at a time), starts the host detached from the exec session (setsid/nohup/disown so it survives session teardown), extracts the public URL (https://<id>-<port>.devbridge-s2.hwtunnel.com), and health-checks it before returning. Use the ACTUAL port reported by huaweicloud_sandbox_deploy_nginx (its "port" field auto-increments on conflict) — never the originally requested port. This automates the manual "Expose the deployed app" flow (huawei-sandbox skill). Returns ok, publicUrl, port, tunnelId, authMode, expiresAt (expiry_hours lifetime, default 72h; 1-720), keepalive.enrolled/tunnelCount/watchdogPid, warnings, sandboxLifetime and urlLifetimeHint. The urlLifetimeHint MUST be relayed to the developer together with the URL: the tunnel expiry is NOT the sandbox lifetime — an idle sandbox shuts down (ephemeral also auto-deletes), which kills the URL. AUTO-ENROLLS the tunnel into the keepalive watchdog (unattended renewal + host re-attach + health check; pass keepalive:false to opt out). The URL is re-verified from a second independent exec session: persistent/verifyHttpCode distinguish a session-surviving URL from one that dies with the deploying session, and a non-persistent URL carries a 请勿分享 warning. Gateway-level tunnel errors (404 "tunnel not found" / "port not configured", 502 "bad gateway") are classified by exact body — an app\'s own 404/502 page is never mistaken for them. When no usable URL is reachable after retries it returns ok:false instead of a dead URL; when the tunnel quota (10006) stays full after the selective cleanup it returns ok:false with error_code devbridge_tunnel_quota_exceeded (keepalive-protected tunnels are preserved — remove unused tunnels or retry with cleanup_mode=all for a full reset). When auto-creation hits the 20-key quota it returns ok:false with error_code HDKIT_DEVBRIDGE_KEY_QUOTA_EXCEEDED, the currentKeys list, and the console cleanup URL; a failed key invalidation self-heals by clearing the cache and recreating before the next probe. The auto-create relay goes through hdkitservice and inherits its 409 HDKIT_VERSION_TOO_OLD version gate: an outdated plugin fails auto-create the same way it fails connect, and the expose failure carries error_code HDKIT_VERSION_TOO_OLD with the upgrade remediation under gateRemediation, and clientVersion and minVersion when the service sends them — upgrade the plugin instead of creating a key by hand.',
    schema: exposeTunnelSchema,
    handler: handleExposeTunnel,
  },
  {
    name: 'huaweicloud_sandbox_expose_poll',
    description:
      'Poll an async expose task started by huaweicloud_sandbox_expose_tunnel with mode: "async". devbox backend: not applicable — expose_tunnel returns the app-port URL synchronously and this tool returns ok:false, code:"HDKIT_BACKEND_UNSUPPORTED", reason:"not_applicable". Returns state: running (the chain is still working — call again), done (result carries the full expose envelope: ok, publicUrl, port, tunnelId, expiresAt, urlLifetimeHint, keepalive, warnings), failed (an unexpected throw escaped the chain, with error), or unknown (no receipt in this MCP server process — it never started here, the session restarted, or the 30-minute receipt expired; the tunnel may already exist, so check huaweicloud_sandbox_deploy_check or re-expose — never assume success without a URL). The urlLifetimeHint MUST be relayed with the URL: the tunnel expiry is not the sandbox lifetime.',
    schema: exposePollSchema,
    handler: handleExposePoll,
  },
  {
    name: 'huaweicloud_sandbox_renew_tunnel',
    description:
      "Renew a DevBridge tunnel's lifetime (devbridge update <id> -e <hours>); devbox backend: not applicable (no tunnel) — returns HDKIT_BACKEND_UNSUPPORTED / not_applicable. — a ROLLING window: expiration = now + hours regardless of remaining time, so renewing before expiry keeps the SAME public URL alive indefinitely (the URL is bound to the tunnel ID and never changes). Default 720h = the 30-day maximum. Returns ok, tunnelId, expiresAt (absolute ISO timestamp read back via show -v — a management-plane loss (10002 tunnel not found) is NOT misread as success), renewedForHours. Use the tunnelId from huaweicloud_sandbox_expose_tunnel or extract it from the URL. The keepalive watchdog renews automatically; this tool is the manual/one-off path.",
    schema: renewTunnelSchema,
    handler: handleRenewTunnel,
  },
  {
    name: 'huaweicloud_sandbox_keepalive_watchdog',
    description:
      'Install or replace the 3-layer keepalive watchdog for a set of tunnels (the tunnel-persistence pattern); devbox backend: not applicable (no tunnel) — returns HDKIT_BACKEND_UNSUPPORTED / not_applicable. Legacy details: (1) host re-attach — restarts `devbridge host <id>` when the host process dies (URL unchanged); (2) daily renewal — `update <id> -e 720` (29-day failure tolerance); (3) health check — curls each URL every 5 minutes and logs WARN on non-200/304. URLs are hardcoded per tunnel (never derived from port-list output — OSC escapes make those greps fail silently). Replaces the current watchdog (expose_tunnel MERGES into it; this tool SETS the list). Returns ok, scriptPath, logPath, watchdogPid, tunnels. The watchdog lives at /tmp/tunnel-keepalive.sh — cleared on reboot (the tunnel LIST dies with it): re-run this tool with the full list after a reboot (a re-expose enrolls only its own NEW tunnel).',
    schema: keepaliveWatchdogSchema,
    handler: handleKeepaliveWatchdog,
  },
  {
    name: 'huaweicloud_sandbox_check_user',
    description:
      'Check if the current user has completed real-name verification and signed the required agreements. devbox backend: skipped locally — returns backend:"devbox", skipped:true, checked:false, realnameVerified:null, agreementSigned:null (no fake verification). Legacy behavior: returns 200 {realnameVerified, agreementSigned} when all good; throws 403 HDKIT_NOT_REALNAME / HDKIT_NOT_AGREEMENT / HDKIT_NOT_REALNAME_AND_AGREEMENT to indicate what is missing. Never signs anything itself.',
    schema: checkUserSchema,
    handler: handleCheckUser,
  },
  {
    name: 'huaweicloud_sandbox_sign_agreement',
    description:
      'Sign all unsigned or outdated agreements for the current user. devbox backend: skipped locally (backend:"devbox", skipped:true) — no signing is needed or performed. Required before huaweicloud_sandbox_connect if check-user returns agreementSigned=false (legacy). CRITICAL: only call after the user explicitly consents to signing — never sign agreements on the user\'s behalf without their explicit request.',
    schema: signAgreementSchema,
    handler: handleSignAgreement,
  },
  {
    name: 'huaweicloud_sandbox_connect',
    description:
      'Connect to a sandbox via hdkitservice. One instance per user per pool — reuses the same-pool sandbox if available, otherwise creates a new one. Quota: 1 instance per pool type (a user may hold 1 ephemeral AND 1 persistent simultaneously; same-type requests reuse the existing instance). On quota exhaustion the API returns HTTP 429 with one of three codes: HDKIT_QUOTA_EXCEEDED (retry useless — release or reuse the existing instance; Retry-After 60), HDKIT_TEMPLATE_QUOTA_EXCEEDED (the running instances of this account for this sandbox type are at the limit — shut down or release an instance of the same type and retry; no Retry-After), or HDKIT_CAPACITY_INSUFFICIENT (pool capacity; retry later / off-peak; Retry-After 60). Gateway 502/504 timeouts during orchestration return a pending receipt (ok:false, pending:true, retryAfter, hint) instead of holding the call through the backoff — the server may already have created the instance; re-call this tool with the SAME parameters after retryAfter and a created instance is reused. An outdated plugin version is rejected by the 409 HDKIT_VERSION_TOO_OLD version gate, surfaced by the sandbox tools (connect/check_user/sign_agreement/credentials) as ok:false and by the voucher trio as claimed:false, always carrying code, message, and remediation naming the upgrade act (npx --yes huaweicloud-devkit@latest update --target <agent>, restart the agent session, or huaweicloud_upgrade), with clientVersion and minVersion present when the service sends them. Returns session_id, dev_stage_id, connection_id, connection_address, expiresAt (STS credential expiry), pool_type/resolved template_id echo, server-configured lifecycle numbers (pool_idle_shutdown_minutes / pool_idle_delete_minutes / pool_reclaim_minutes) and started (true when a reused instance was woken from shutdown). Lifecycle hints are announced only on the first connect of a session or when started=true. Ephemeral pool (default): idle auto-shutdown after 30min, auto-delete after 1h — do not keep important data there. Persistent pool: data disk retained (EVS 32G), idle shutdown after 1h, idle reclaim capped at 7 days. Numbers are configured by hdkitservice; the text follows the server echo and falls back to these defaults. devbox backend (HW_SANDBOX_BACKEND=devbox): tenant = STS principal_id (each IAM sub-account gets its own ephemeral sandbox; account/domain are audit-only, never isolation/quota); only ephemeral is supported (persistent → ok:false HDKIT_BACKEND_UNSUPPORTED); every control-plane call uses the user AK/SK (+ optional X-HW-Security-Token) — there is no sandbox key, so AK/SK rotation or a devkit restart requires re-authentication; agency/temporary credentials are rejected with HDKIT_IDENTITY_UNSUPPORTED; env maps to envVars; git is NOT accepted at create (clone with exec_one_shot or use upload_project); timeout_seconds sets the sandbox TTL (10-86400, default 1800); EnvD connect tokens stay in process memory and never appear in this result. Vendor-gated (vendorConfirmed): call only when the vendor is established — see the vendorConfirmed parameter description; when unknown, ask which cloud the user means first.',
    schema: connectSchema,
    handler: handleConnect,
  },
  {
    name: 'huaweicloud_sandbox_credentials',
    description:
      'Configure temporary AK/SK for a sandbox via hdkitservice. Validates the current AK/SK against IAM before injecting (invalid SK is rejected here instead of failing later with APIGW.0301 during exec), then injects temporary credentials into the sandbox. Also injects an optional DevBridge API Key — required for devbridge 0.2.x tunnel exposure because 0.2.x removed AK/SK login. The API Key is a long-lived account-level credential, so it is stored in a separate file (/tmp/hw_api_key, 0600) from the temporary AK/SK (/tmp/hw_creds.sh). Source of truth: local HW_API_KEY env first, then the api_key param. The sandbox must be in RUNNING state. devbox backend: NOT supported — returns ok:false, code:"HDKIT_BACKEND_UNSUPPORTED"; use connect envVars or write /tmp files with exec_one_shot.',
    schema: credentialsSchema,
    handler: handleCredentials,
  },
  {
    name: 'huaweicloud_sandbox_shutdown',
    description:
      'Shut down a running sandbox via hdkitservice to stop core-hour consumption. This calls DevStation close, NOT delete: the instance is retained; for persistent sandboxes the EVS data disk is also retained. A later huaweicloud_sandbox_connect wakes it. Works for both ephemeral and persistent sandboxes. devbox backend: shutdown = pause (state:"paused", pause_retention_hours 168 by default; a later connect resumes the same sandbox); the platform Key capacity is still counted while paused. Only call when the developer explicitly asks to shut down; never auto-shutdown. Returns devStageId, status (stopped/shutting_down/already_stopped/close_requested) and message on legacy; state/paused_at/pause_retention_hours on devbox.',
    schema: shutdownSchema,
    handler: handleShutdown,
  },
  {
    name: 'huaweicloud_sandbox_kill',
    description:
      'Permanently DELETE a devbox sandbox. devbox-only: on the legacy DevStation backend it returns ok:false, code:"HDKIT_BACKEND_UNSUPPORTED" — use huaweicloud_sandbox_shutdown (pause) there. kill is irreversible: the sandbox, its data, and its app-port URL are gone; a later connect creates a NEW sandbox. Requires the always-approval gate and an explicit second confirmation from the developer. Same tenant (principal_id) can connect again after kill (the active slot is released).',
    schema: killSchema,
    handler: handleKill,
  },
] as const satisfies readonly PackToolDefinition[];

export type SandboxToolName = (typeof SANDBOX_TOOLS)[number]['name'];

// Schema map keyed by tool name for src/tool-schemas.ts: TOOL_SCHEMAS spreads
// it in place, keeping the satisfies Record<ToolName, LooseToolSchema>
// completeness check over every ToolName key.
export const SANDBOX_TOOL_SCHEMAS: Readonly<Record<SandboxToolName, LooseToolSchema>> = {
  huaweicloud_sandbox_exec_with_session: execWithSessionSchema,
  huaweicloud_sandbox_exec_one_shot: execOneShotSchema,
  huaweicloud_sandbox_exec_poll: execPollSchema,
  huaweicloud_sandbox_close_session: closeSessionSchema,
  huaweicloud_sandbox_upload_file: uploadFileSchema,
  huaweicloud_sandbox_upload_project: uploadProjectSchema,
  huaweicloud_sandbox_deploy_nginx: deployNginxSchema,
  huaweicloud_sandbox_deploy_check: deployCheckSchema,
  huaweicloud_sandbox_expose_tunnel: exposeTunnelSchema,
  huaweicloud_sandbox_expose_poll: exposePollSchema,
  huaweicloud_sandbox_renew_tunnel: renewTunnelSchema,
  huaweicloud_sandbox_keepalive_watchdog: keepaliveWatchdogSchema,
  huaweicloud_sandbox_check_user: checkUserSchema,
  huaweicloud_sandbox_sign_agreement: signAgreementSchema,
  huaweicloud_sandbox_connect: connectSchema,
  huaweicloud_sandbox_credentials: credentialsSchema,
  huaweicloud_sandbox_shutdown: shutdownSchema,
  huaweicloud_sandbox_kill: killSchema,
};

// Dispatch map merged into PACK_TOOL_HANDLERS in packs/registry.ts. Typed over
// SandboxToolName, so a tool added to SANDBOX_TOOLS without a handler entry
// here — or the reverse — fails to compile instead of failing at runtime.
export const SANDBOX_TOOL_HANDLERS: Readonly<Record<SandboxToolName, PackToolDefinition['handler']>> = {
  huaweicloud_sandbox_exec_with_session: handleExecWithSession,
  huaweicloud_sandbox_exec_one_shot: handleExecOneShot,
  huaweicloud_sandbox_exec_poll: handleHwexecPoll,
  huaweicloud_sandbox_close_session: handleCloseSession,
  huaweicloud_sandbox_upload_file: handleUploadFile,
  huaweicloud_sandbox_upload_project: handleUploadProject,
  huaweicloud_sandbox_deploy_nginx: handleDeployNginx,
  huaweicloud_sandbox_deploy_check: handleDeployCheck,
  huaweicloud_sandbox_expose_tunnel: handleExposeTunnel,
  huaweicloud_sandbox_expose_poll: handleExposePoll,
  huaweicloud_sandbox_renew_tunnel: handleRenewTunnel,
  huaweicloud_sandbox_keepalive_watchdog: handleKeepaliveWatchdog,
  huaweicloud_sandbox_check_user: handleCheckUser,
  huaweicloud_sandbox_sign_agreement: handleSignAgreement,
  huaweicloud_sandbox_connect: handleConnect,
  huaweicloud_sandbox_credentials: handleCredentials,
  huaweicloud_sandbox_shutdown: handleShutdown,
  huaweicloud_sandbox_kill: handleKill,
};
