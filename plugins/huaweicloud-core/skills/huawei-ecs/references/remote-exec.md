# Remote Command Execution on ECS

Standard flow for executing commands inside a running ECS instance. Use this when:
- first-boot user_data/cloud-init provisioning failed and you must fix it on a live instance
- you need to install packages, verify services, or debug an instance interactively
- SCP or other policies block SSH and you still need instance-level access

## Method 1: SSH (recommended)

Prerequisites:
- A keypair created and injected at instance creation (`--server.key_name=<keypair-name>`, see create-instance.md §5). If the instance was created with a password, SSH with that instead.
- Security group allows inbound TCP 22 from your IP.
- An EIP bound to the instance (or a private IP reachable from a bastion).

Flow:

1. Get the public IP:
   ```bash
   hcloud ECS ListServersDetails --cli-region=<region> --server_id=<instance-id>
   # → addresses.<vpc-id>[].OS-EXT-IPS:addr (the floating IP)
   ```
2. Find the image default user: Huawei Cloud EulerOS / CentOS / Rocky → `root`; Ubuntu → `ubuntu`.
3. Connect:
   ```bash
   ssh -i <private-key-file> <default-user>@<eip>
   ```
4. Run the deployment/debug commands directly in the shell.

## Method 2: cloud-init user_data re-bootstrap

user_data runs only on first boot — it cannot be re-run on a live instance. To use it again, rebuild the instance (delete + re-create with corrected user_data). See create-instance.md §6b. Not suitable for ad-hoc commands.

## Method 3: Huawei Cloud CloudShell (console-based)

CloudShell is a browser-based terminal in the Huawei Cloud console — it does not expose a programmatic/KooCLI API for agents. Use it only for human-in-the-loop debugging when SSH is not usable (e.g. no keypair was injected). An agent cannot drive CloudShell directly.

## After connecting

- Check cloud-init failure logs: `tail -n 200 /var/log/cloud-init-output.log`
- Re-run the failed deployment steps manually (e.g. `dnf install nginx`, `systemctl start nginx`)
- Verify the service listens: `ss -lntp | grep <port>`
