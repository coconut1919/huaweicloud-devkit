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
>
> **First boot only**: cloud-init runs user_data (the `scripts-user` module) only on the instance's **first boot**. Rebooting (`BatchRebootServers`) or restarting the instance does NOT re-run it — an instance that failed its first-boot script stays in that state after a reboot.

## 6b. Recovery after user_data failure

If first-boot provisioning failed (e.g. `dnf install`/`yum` failed because the subnet had no DNS at creation time):

1. **Fix the subnet DNS first** (root cause): `hcloud VPC UpdateSubnet --subnet_id=<id> --subnet.dnsList.1=<dns1> --subnet.dnsList.2=<dns2>` — see `huawei-vpc` references/network.md for region DNS values.
2. **Method A — rebuild the instance** (recommended for reproducible deploys): delete the old instance with `hcloud ECS DeleteServers --servers.1.id=<id> --delete_publicip=true --delete_volume=true`, then re-create it from step 6 re-injecting the corrected user_data. The new instance's first boot re-runs the script against the now-working subnet DNS.
3. **Method B — run commands in the instance manually**: SSH into the running instance and execute the deployment steps by hand. See `references/remote-exec.md` for the SSH/remote-exec flow. This does not require deleting anything.

> Do NOT rely on reboot to retry a failed first-boot script — cloud-init will not re-run user_data. Pick Method A or B above.

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
