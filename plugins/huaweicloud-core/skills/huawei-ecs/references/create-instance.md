# Create ECS Instance SOP

**Before executing any command: If MCP tools are not available** (new session after install), restart your session or use hcloud CLI directly with caution. Commands using adminPass/password WILL appear in shell history — prefer key_name.

## 1. Discover flavors
hcloud ECS ListFlavors --cli-region=<region> --cli-output=json
Filter for `os_extra_specs.cond:operation:status == normal` — most results are abandoned. See references/flavors.md.

## 2. Find availability zones
hcloud ECS NovaListAvailabilityZones --cli-region=<region>

## 3. Find image

```bash
# Broad search — specific names may return empty in some regions
hcloud IMS ListImages --cli-region=<region> --__imagetype=gold --__isregistered=true --limit=20
```

If searching by name (e.g. --name="Ubuntu") returns empty: use broad search without name filter, pick from results. Some regions only offer Huawei Cloud EulerOS (HCE).

Common images (verify live per region):
| Image | Region | ID |
|-------|--------|----|
| HCE 2.0 Standard | cn-north-4 | 7d940784-ac0a-425f-b3fa-8478f1a1df70 |
| Ubuntu 22.04 | Query live | Query live |
| CentOS 8.2 | Query live | Query live |

## 4. Verify or create VPC/subnet
hcloud VPC ListVpcs --cli-region=<region>
hcloud VPC ListSubnets --vpc_id=<vpc-id> --cli-region=<region>
If no VPC/subnet exists: load `huawei-vpc` skill → create VPC → create subnet (with DNS) → create security group → return here.

## 5. Create keypair (recommended over adminPass)
hcloud ECS NovaCreateKeypair --keypair.name=<name>
Save the returned private key to a local file. The public key is auto-injected.

Password alternative:
- adminPass: 8-26 chars, must have uppercase + lowercase + digit + special char
- Passwords appear ONCE in creation output and are not retrievable
- Passwords are logged in shell history — this is a security risk

## 6. Create instance
hcloud ECS CreateServers --cli-region=<region> --server.name=<name> --server.flavorRef=<flavor-id> --server.imageRef=<image-id> --server.nics.1.subnet_id=<subnet-id> --server.root_volume.volumetype=<type> --server.root_volume.size=<minsize> --server.vpcid=<vpc-id> --server.availability_zone=<az> --server.key_name=<keypair-name> --server.count=1

### Bootstrap with user_data (cloud-init)

Use `--server.user_data` to run a cloud-init script at first boot. The value must be **base64-encoded**. This is also the recommended bootstrap path when SCP policies block SSH access — user_data serves as the full deployment path, no SSH needed.

```bash
# Encode the script
user_data=$(cat << 'SCRIPT' | base64
#!/bin/bash
# Your bootstrap commands here.
# Output logs: /var/log/cloud-init-output.log
SCRIPT
)

hcloud ECS CreateServers ... --server.user_data=$user_data
```

> **Security**: Never embed secrets (passwords, AK/SK, tokens) in user_data. It is stored unencrypted and readable from within the instance via IMDS. Fetch secrets at boot from DEW/CSMS instead.
>
> **Debugging**: If the script didn't run, check `/var/log/cloud-init-output.log` on the instance.

**First-boot only — reboots do NOT re-run user_data**: The `scripts-user` cloud-init module executes user_data **only on the instance's first boot**. Restarting an instance (`BatchRebootServers`), even after fixing the underlying cause (e.g. adding subnet DNS), will NOT re-run your deployment script — cloud-init reports `modules:config` as complete and skips scripts-user on subsequent boots. **Do not "reboot to retry" a failed cloud-init deployment; it will silently do nothing.**

### Failure recovery

If the first-boot deployment failed (e.g. cloud-init could not resolve package repos because the subnet had no DNS at creation time), the instance will never re-run user_data. Two recovery paths:

**Method A — Recreate the instance (recommended for scripted setup)**:

1. Fix the prerequisite first: if the failure was DNS-related, ensure the subnet has DNS configured (see `huawei-vpc` skill → `references/network.md`). Note: fixing the subnet does NOT fix an already-booted instance — it only helps newly created ones.
2. Delete the failed instance, releasing its resources: `hcloud ECS DeleteServers --servers.1.id=<id> --delete_publicip=true --delete_volume=true`
3. Re-run `hcloud ECS CreateServers` from step 6, re-injecting the same `--server.user_data`. On this new instance's first boot, cloud-init runs scripts-user again.

**Method B — SSH into the instance and run the deployment manually (no recreate)**:

1. Ensure the security group allows inbound TCP 22 and the instance has a public EIP (see `references/remote-exec.md` in the `huawei-ecs` skill).
2. `ssh -i <private-key.pem> root@<eip-address>` (or the image's default user, e.g. `ubuntu@` for Ubuntu images).
3. Run the deployment commands directly, or re-run the original script manually.
4. Verify the application responds (e.g. `curl http://<eip-address>`).

## 7. EIP (two methods)

### Method A: Inline with CreateServers (Recommended)
Add EIP parameters to the `CreateServers` command in step 6:

```bash
hcloud ECS CreateServers \
  --server.publicip.eip.iptype=<type> \
  --server.publicip.eip.bandwidth.sharetype=<share-type> \
  --server.publicip.eip.bandwidth.size=<size> \
  --server.publicip.eip.bandwidth.chargemode=traffic \
  ...
```

> **Trap**: Parameter names differ from `EIP CreatePublicip`. Use `iptype` (not `type`), `sharetype` (not `share_type`), and `chargemode` (not `charging_mode`). Always verify with `hcloud ECS CreateServers --help`.

### Method B: Create and bind separately
hcloud EIP CreatePublicip --publicip.type=<type> --bandwidth.size=<size> --bandwidth.share_type=<share-type> --bandwidth.name=<name>

```bash
# Get the ECS network port ID
hcloud ECS ListServersDetails --cli-region=<region> --server_id=<instance-id>
# → addresses.<vpc-id>[].OS-EXT-IPS:port_id

# Bind EIP via port
hcloud EIP AssociatePublicips --publicip_id=<eip-id> --publicip.associate_instance_id=<port-id> --publicip.associate_instance_type=PORT
```

## 8. Verify
hcloud ECS ListServersDetails --cli-region=<region> --server_id=<instance-id>
Expected: status=ACTIVE

### Verify HTTP accessibility (if EIP bound)

```bash
# Get the EIP address from instance details
hcloud ECS ListServersDetails --cli-region=<region> --server_id=<instance-id>
# → addresses.<vpc-id>[].OS-EXT-IPS:addr

curl http://<eip-address>
# Expected: HTTP 200 (if port 80 open and web server installed)

## 9. Delete instance (with cleanup)
hcloud ECS DeleteServers --servers.1.id=<instance-id> --delete_publicip=true --delete_volume=true
Warning: --delete_publicip and --delete_volume default to false. Set to true to avoid orphaned charges.

## Constraints
- Name: 1-64 chars, letters/digits/hyphens
- Flavor: must be available in target region — always ListFlavors first
- Root volume: SSD 40GB min
- Keypair is safer than adminPass (passwords leak into shell history)
