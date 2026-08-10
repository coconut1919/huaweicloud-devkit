# Remote Command Execution on ECS

Standard procedures for running commands inside an ECS instance after deployment, when cloud-init/user_data is not an option (e.g. first-boot already passed, or you need interactive/session-based commands).

> **user_data runs only on first boot.** If the instance already booted, rebooting does NOT re-run user_data. Use SSH (below) instead. See `references/create-instance.md` §Failure recovery.

## Prerequisites for SSH access

1. Security group allows inbound TCP 22 (see `huawei-vpc` skill → `references/security-group.md`)
2. Instance has a public EIP bound (see `huawei-ecs` SKILL.md → Common Workflows → Bind EIP)
3. Instance was created with `--server.key_name=<keypair-name>` and the private key is saved locally
4. `hcloud` machine can reach the EIP (public network)

## Method 1: SSH (recommended)

```bash
# Get the instance's public IP
hcloud ECS ListServersDetails --cli-region=<region> --server_id=<instance-id>
# → addresses.<vpc-id>[].OS-EXT-IPS:addr

# Connect (user depends on the image):
#   Ubuntu → ubuntu, Huawei Cloud EulerOS → root, CentOS → root
ssh -i <private-key.pem> <user>@<eip-address>

# Example: install and start nginx
ssh -i <key.pem> root@<eip> 'dnf install -y nginx && systemctl enable --now nginx'
```

- Use the private key saved at keypair creation time. Passwords (`adminPass`) are weaker and leak into shell history.
- Add `-o StrictHostKeyChecking=accept-new` on first connect to avoid interactive host-key prompts (which hang agents).
- Non-interactive single commands: `ssh -i <key> <user>@<eip> '<command>'`.

## Method 2: CloudShell (browser console, no programmatic API)

Huawei Cloud CloudShell is a web-based console reachable from the ECS management console (instance → Remote Login → CloudShell). It does NOT expose a REST/KooCLI API for running commands, so it cannot be automated by an agent — use it only as a manual fallback for interactive debugging.

## Troubleshooting remote execution

| Symptom | Fix |
|---------|-----|
| Connection refused/timeout | SG missing port 22 → add ingress rule; or no EIP bound → bind one |
| Permission denied (publickey) | Wrong key or user → use the image default user; verify keypair name at creation |
| `ssh` not found / Windows | Use PowerShell `ssh.exe`, or run via WSL / Git Bash |
| SCP policy blocks SSH (`SYS.0403`) | Fall back to cloud-init user_data on a NEW instance (first boot), see `references/create-instance.md` |

> **No RunCommand API**: Unlike some clouds, Huawei Cloud ECS has no public "run command on instance" API for arbitrary shell execution. The supported paths are SSH (above) and first-boot cloud-init user_data.
