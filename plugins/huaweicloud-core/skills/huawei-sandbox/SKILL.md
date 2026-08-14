---
name: huawei-sandbox
description: "Use when creating, connecting, or managing Huawei Cloud Sandbox instances and workspace terminals. Covers sandbox lifecycle (check-user, sign-agreement, connect, release), terminal execution (one-shot and session-based), and credential injection. Triggers on: sandbox, workspace, terminal, hwlink, devstation, hdkitservice, remote exec. NOT for: ECS instances (use huawei-ecs), CCE clusters (use huawei-cce)."
version: 1
---

# Huawei Cloud Sandbox

**STOP - Do not answer from general knowledge.** Follow the procedure below.

## Overview

Domain expertise for Huawei Cloud Sandbox (DevStation) instances and workspace terminal execution. Covers sandbox lifecycle via hdkitservice API and remote terminal command execution via hwlink protocol.

## MCP Tools

### User Verification (Prerequisites)

| Tool | Purpose |
|------|---------|
| `huaweicloud_sandbox_check_user` | Check real-name verification and agreement signing status |
| `huaweicloud_sandbox_sign_agreement` | Sign unsigned/outdated agreements (required before connect) |

### Sandbox Lifecycle

| Tool | Purpose |
|------|---------|
| `huaweicloud_sandbox_connect` | Connect to sandbox (one user one instance, reuses existing if available) |
| `huaweicloud_sandbox_credentials` | Inject temporary AK/SK into a running sandbox |
| `huaweicloud_sandbox_release` | Shut down and delete a sandbox (idempotent) |

### Terminal Execution

| Tool | Purpose |
|------|---------|
| `huaweicloud_sandbox_exec_with_session` | Session-based execution (state persists) |
| `huaweicloud_sandbox_close_session` | Close a persistent terminal session |

## Workflow

1. **Check user**: `huaweicloud_sandbox_check_user` — verify `realname_verified` and `agreement_signed`
2. **Sign agreement** (if needed): `huaweicloud_sandbox_sign_agreement` — when `agreement_signed=false`
3. **Connect**: `huaweicloud_sandbox_connect` — returns `session_id`, `dev_stage_id`, `connection_id`, `connection_address`
4. **Inject credentials** (optional): `huaweicloud_sandbox_credentials` — enables cloud API access from sandbox
5. **Execute commands**: `huaweicloud_sandbox_exec_with_session` for interactive work
6. **Release**: `huaweicloud_sandbox_release` — cleans up sandbox and session

## Re-deploy

A "re-deploy" (重新部署) must tear down the previous sandbox before creating a new one — `huaweicloud_sandbox_connect` reuses the existing sandbox (one user one instance), so calling connect again without a release returns the stale sandbox.

1. **Release the old sandbox**: `huaweicloud_sandbox_release` with the previous `session_id`/`dev_stage_id` (also clears any cached terminal sessions)
2. **Connect again**: `huaweicloud_sandbox_connect` with the git config → returns a fresh `session_id`/`dev_stage_id`
3. **Inject credentials into the new sandbox**: `huaweicloud_sandbox_credentials` with the NEW `session_id`/`dev_stage_id` — a new sandbox has no temporary AK/SK yet, so skipping or reusing the old ids leaves the sandbox without credentials
4. **Deploy**: `huaweicloud_sandbox_exec_with_session` with the NEW `dev_stage_id`

## Critical Warnings

| Trap | Why |
|------|-----|
| Agreement required first | `sandbox_connect` fails if user hasn't signed agreements; run `sandbox_check_user` first |
| Session state persists | `exec_with_session` preserves `cd`, env vars, aliases between calls |
| Destructive commands blocked | `rm -rf /`, `mkfs`, `dd if=`, fork bombs are denied by safety policy |
| Workspace ID = dev_stage_id | Use `dev_stage_id` from `sandbox_connect` as `workspace_id` for terminal exec |
| Re-deploy needs a fresh sandbox | `sandbox_connect` reuses the existing sandbox; release first, then re-connect and re-inject credentials with the new ids |
| Node.js >= 22 required | Sandbox terminal uses built-in WebSocket (globalThis.WebSocket) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HW_ACCESS_KEY` | Yes | Huawei Cloud AK |
| `HW_SECRET_KEY` | Yes | Huawei Cloud SK |
| `HW_SECURITY_TOKEN` | No | STS security token |
| `HW_WORKSPACE_ID` | No | Default workspace ID |
| `HDKITSERVICE_ENDPOINT` | No | hdkitservice API endpoint |
| `HWLINK_ENDPOINT` | No | DevStation API endpoint |
