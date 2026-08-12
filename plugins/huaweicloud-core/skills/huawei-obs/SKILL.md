---
name: huawei-obs
description: "Use when creating, configuring, or managing OBS buckets and objects on Huawei Cloud. Covers bucket creation, lifecycle policies, versioning, static website hosting, CORS, access control (IAM/bucket policy/ACL), cross-region replication, event notifications, and presigned URLs. Triggers on: OBS, bucket, object storage, lifecycle, versioning, static website, CORS, presigned, replication. NOT for: EVS block storage (use huawei-ecs), SFS file storage, CBR backup (use huawei-cbr)."
version: 1
---

# Huawei Cloud OBS

**STOP - Do not answer from general knowledge.** Follow the procedure below.

## Critical: OBS Command Syntax

KooCLI OBS uses **obsutil-style** commands, NOT API-style operations. Always run `hcloud OBS help` (no `--`) before constructing commands:

```bash
hcloud OBS help           # NOT --help
hcloud OBS help <command> # e.g. hcloud OBS help mb
```

| Wrong (API-style) | Correct (obsutil-style) |
|-------------------|-------------------------|
| `OBS CreateBucket` | `OBS mb obs://<bucket>` |
| `OBS PutObject` | `OBS cp <file> obs://<bucket>/` |
| `OBS DeleteBucket` | `OBS rm obs://<bucket> -r` |

## Overview

Domain expertise for Huawei Cloud Object Storage Service (OBS). Covers bucket/object lifecycle, access control, static website hosting, and presigned URLs.

## Critical Warnings

| Trap | Why |
|------|-----|
| Bucket name is global | All users share bucket namespace |
| Three-layer permissions | IAM > Bucket Policy > ACL. Most restrictive wins |
| Versioning is irreversible | Once enabled, cannot be disabled, only suspended |
| OBS uses AK/SK directly | NOT IAM tokens. Auth errors mean check AK/SK validity |
| Static website via CLI missing | KooCLI OBS lacks website config. Use REST API or console |
| **OBS needs separate cred config** | `hcloud configure` is NOT enough for OBS. Before any OBS operation, call `huaweicloud_setup_obs_config` to sync credentials from hcloud profile. |
| **obsutil interactive prompts** | `cp`/`rm` without `-f` causes "Please input (y/n)" → Agent hangs (TIMEOUT). Always use `-f` for non-interactive. |
| **Directory upload adds prefix** | `cp <dir>/ obs://<bucket>/ -r` puts files under `bucket/<dir>/...`. Use `-flat` for root-level files (static sites). Preview with `-dryRun` first. |

## OBS Credential Setup (Required Before First Use)

KooCLI OBS uses a separate config file (`~/.obsutilconfig`), NOT `~/.hcloud/config.json`. Call `huaweicloud_setup_obs_config` to automatically sync credentials from the active hcloud profile. No manual AK/SK entry needed.

> **KooCLI credential masking**: If `hcloud configure show` returns masked/encrypted AK/SK (containing `****`), the automatic sync will fail because hcloud does not expose plaintext credentials. In this case, the agent will receive a `maskedCredential` error. Fallback: ask the user to run `hcloud OBS configure -i` interactively outside agent chat to set OBS credentials, or export `OBS_ACCESS_KEY_ID` and `OBS_SECRET_ACCESS_KEY` environment variables as a one-time workaround.

## Common Workflows

| Task | Command |
|------|---------|
| Create bucket | `hcloud OBS mb obs://<bucket> -location=<region>` |
| List buckets/objects | `hcloud OBS ls [obs://<bucket>]` |
| Upload file | `hcloud OBS cp <file> obs://<bucket>/<key>` |
| Upload directory (recursive) | `hcloud OBS cp <dir>/ obs://<bucket>/ -r -f -flat` |
| Download object | `hcloud OBS cp obs://<bucket>/<key> <local-path>` |
| Set bucket ACL | `hcloud OBS chattri obs://<bucket> -acl=public-read` |
| Set object ACL | `hcloud OBS chattri obs://<bucket>/<key> -acl=public-read` | Bucket ACL does NOT cascade — anonymous reads need both |
| Set lifecycle | `hcloud OBS lifecycle obs://<bucket> -method=put -localfile=<json>` |
| Set bucket policy | `hcloud OBS bucketpolicy obs://<bucket> -method=put -localfile=<json>` |
| Set CORS | `hcloud OBS cors obs://<bucket> -method=put -localfile=<json>` |
| Delete bucket | `hcloud OBS rm obs://<bucket> -r` (must be empty) |
| Presigned URL | `hcloud OBS sign obs://<bucket>/<key> -e=<seconds>` |
| Object metadata | `hcloud OBS stat obs://<bucket>/<key>` |

## Static Website Deployment Workflow

See `references/static-website.md` for the full end-to-end workflow:
Build → Create bucket → Upload → Set bucket ACL → Set object ACL → Configure website (REST API/console)

> KooCLI OBS does NOT support `SetBucketWebsite`. Configure static website hosting via REST API (`PUT /?website`) or the Huawei Cloud console.

## Storage Classes

| Class | Use Case | Min Storage | Retrieval Fee |
|-------|----------|-------------|---------------|
| STANDARD | Frequently accessed | None | No |
| STANDARD_IA | Infrequent access | 30 days | Yes |
| ARCHIVE | Long-term archive | 90 days | Yes (hours) |

## Troubleshooting

| Error | Root Cause -> Fix |
|-------|------------------|
| AccessDenied on bucket | IAM/bucket policy/ACL conflict -> Check all three layers |
| BucketAlreadyExists | Name taken globally -> Choose different name |
| NoSuchKey | Object doesn't exist or wrong region -> Verify key and region |
| InvalidAccessKeyId | OBS uses AK/SK directly -> Verify AK/SK validity, OBS endpoint, OBS permissions |
| EntityTooLarge | Single PUT limit 5GB -> Use multipart upload |
| OBS --help fails | KooCLI OBS uses `help` not `--help` -> Run `hcloud OBS help` |

## Security Considerations

- MUST block public access by default
- MUST use HTTPS-only for buckets
- SHOULD enable access logging for audit
- SHOULD rotate presigned URL expiry (max 7 days)
- MUST NOT store AK/SK in bucket policies

## Cross-Skill References

- **EIP**: See `huawei-vpc` for public network access
- **DEW**: See `huawei-dew` for secret management

## References

- OBS Docs: https://support.huaweicloud.com/obs/
- Static website: references/static-website.md
- Lifecycle: references/bucket-lifecycle.md
- Replication: references/replication.md
