# Resource Purchase Catalog

Every resource type the orchestration flow can purchase, bind, and destroy. This is the authoritative checklist when composing a deployment plan.

> **Operation names below are entry points, not gospel.** Always confirm exact parameters with `hcloud <Service> <Operation> --help` before planning a command. When an operation name is uncertain, run `hcloud <Service> --help` first.

## Networking (foundation - create first, destroy last)

> **v3 API notes (verified by E2E)**: `CreateSecurityGroup` is account-scoped - NO `vpc_id` param. `CreateSecurityGroupRule` uses `multiport=80` (not `port_range_min/max`). `DeleteSubnet` requires `--vpc_id` in addition to `--subnet_id`. Deletion APIs return empty output on success (async 202/204) - confirm via list, not stdout.

| Resource             | Create                                                                                                                                                                                                                                        | Delete                                                             | Skill      | Depends on                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| VPC                  | `hcloud VPC CreateVpc --vpc.name=<n> --vpc.cidr=<cidr>`                                                                                                                                                                                       | `hcloud VPC DeleteVpc --vpc_id=<id>`                               | huawei-vpc | -                                                                                                                                           |
| Subnet               | `hcloud VPC CreateSubnet --subnet.name=<n> --subnet.cidr=<cidr> --subnet.gateway_ip=<gw> --subnet.vpc_id=<id>`                                                                                                                                | `hcloud VPC DeleteSubnet --subnet_id=<id> --vpc_id=<id>`           | huawei-vpc | VPC                                                                                                                                         |
| Security group       | `hcloud VPC CreateSecurityGroup --security_group.name=<n>` (v3: account-scoped, no vpc_id)                                                                                                                                                    | `hcloud VPC DeleteSecurityGroup --security_group_id=<id>`          | huawei-vpc | -                                                                                                                                           |
| Security group rules | `hcloud VPC CreateSecurityGroupRule --security_group_rule.security_group_id=<id> --security_group_rule.direction=ingress --security_group_rule.protocol=tcp --security_group_rule.multiport=80 --security_group_rule.remote_ip_prefix=<cidr>` | `hcloud VPC DeleteSecurityGroupRule --security_group_rule_id=<id>` | huawei-vpc | Security group. New SGs deny ALL inbound - rules are mandatory. Risk rules block `0.0.0.0/0` exposure - use the VPC CIDR for internal rules |
| EIP                  | `hcloud EIP CreatePublicip`                                                                                                                                                                                                                   | `hcloud EIP DeletePublicip`                                        | huawei-vpc | - (bills when idle)                                                                                                                         |
| EIP bind             | `hcloud EIP AssociatePublicips --publicip.associate_instance_type=PORT`                                                                                                                                                                       | `hcloud EIP DisassociatePublicips`                                 | huawei-vpc | EIP + target port                                                                                                                           |

## Compute

| Resource      | Create                                                                                                                                                                                                                                                                                                                                                                               | Delete                                                                                     | Skill      | Depends on                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| ECS instance  | `hcloud ECS CreateServers --server.name=<n> --server.flavorRef=<id> --server.imageRef=<id> --server.vpcid=<id> --server.nics.1.subnet_id=<id> --server.security_groups.1.id=<id> --server.availability_zone=<az> --server.root_volume.volumetype=<type>` (hidden required: `vpcid` + `root_volume.volumetype`; check flavor family vs image arch, e.g. kc1 = ARM needs an ARM image) | `hcloud ECS DeleteServers --servers.1.id=<id> --delete_publicip=true --delete_volume=true` | huawei-ecs | VPC + Subnet + SG. Set both delete flags true on teardown or EIP/disk leak |
| EVS data disk | `hcloud EVS CreateVolume`                                                                                                                                                                                                                                                                                                                                                            | `hcloud EVS DeleteVolume`                                                                  | huawei-ecs | - (attach with `hcloud EVS AttachVolume`)                                  |

## Databases

| Resource                    | Create                                                    | Delete                                                  | Skill          | Depends on   |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | -------------- | ------------ |
| RDS (MySQL/PG/SQLServer)    | discover with `hcloud RDS --help` (CreateInstance family) | discover with `hcloud RDS --help`                       | huawei-rds     | VPC + Subnet |
| GaussDB                     | discover with `hcloud GaussDB --help`                     | discover with `hcloud GaussDB --help`                   | huawei-gaussdb | VPC + Subnet |
| DDS (MongoDB) / DCS (Redis) | discover with `hcloud DDS --help` / `hcloud DCS --help`   | discover with `hcloud DDS --help` / `hcloud DCS --help` | huawei-dds-dcs | VPC + Subnet |

## Storage / Delivery

| Resource                | Create                                                                                                                                                         | Delete                                                              | Skill        | Depends on                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| OBS bucket              | `hcloud OBS mb obs://<bucket> -location=<region>` (NO `-f`; `-location` is mandatory even with a regional endpoint; same-name re-create is idempotent success) | `hcloud OBS rm obs://<bucket> -f` (empty objects first; idempotent) | huawei-obs   | -                                                                                  |
| Upload objects          | `hcloud OBS cp <src> obs://<bucket>/ -f -acl=public-read`                                                                                                      | -                                                                   | huawei-obs   | Bucket. Per-object ACL mandatory - bucket ACL does not cascade                     |
| Static website hosting  | `hcloud OBS chattri` (website config)                                                                                                                          | -                                                                   | huawei-obs   | Bucket. Bucket name must equal the custom domain                                   |
| CDN acceleration domain | discover with `hcloud CDN --help` (CreateDomain family)                                                                                                        | disable then delete                                                 | - (no skill) | OBS source or ECS origin. Mainland acceleration requires ICP filing                |
| DNS record set          | discover with `hcloud DNS --help` (CreateRecordSet family)                                                                                                     | discover with `hcloud DNS --help`                                   | - (no skill) | CDN CNAME + domain hosted in Huawei Cloud DNS (check `hcloud DNS ListPublicZones`) |

## Serverless / API

| Resource               | Create                                        | Delete                                      | Skill                | Depends on                                                |
| ---------------------- | --------------------------------------------- | ------------------------------------------- | -------------------- | --------------------------------------------------------- |
| FunctionGraph function | `hcloud FunctionGraph CreateFunction`         | discover with `hcloud FunctionGraph --help` | huawei-functiongraph | -                                                         |
| FunctionGraph trigger  | `hcloud FunctionGraph CreateFunctionTrigger`  | discover with `hcloud FunctionGraph --help` | huawei-functiongraph | Function. Use DEDICATEDGATEWAY (not deprecated APIG type) |
| APIG instance          | `hcloud APIG CreateInstanceV2 --spec_id=<id>` | discover with `hcloud APIG --help`          | huawei-apig          | -                                                         |

## Container

| Resource                | Create                            | Delete                            | Skill      | Depends on                                       |
| ----------------------- | --------------------------------- | --------------------------------- | ---------- | ------------------------------------------------ |
| CCE cluster + node pool | discover with `hcloud CCE --help` | discover with `hcloud CCE --help` | huawei-cce | VPC + Subnet. Long creation time - warn the user |

## Messaging / Backup / Observability / Security

| Resource                      | Create                                                  | Delete                            | Skill            |
| ----------------------------- | ------------------------------------------------------- | --------------------------------- | ---------------- |
| SMN topic / subscription      | discover with `hcloud SMN --help`                       | discover with `hcloud SMN --help` | huawei-smn-dms   |
| DMS queue (Kafka/RocketMQ)    | discover with `hcloud DMS --help`                       | discover with `hcloud DMS --help` | huawei-smn-dms   |
| CBR vault / policy            | discover with `hcloud CBR --help`                       | discover with `hcloud CBR --help` | huawei-cbr       |
| CES alarm rule                | discover with `hcloud CES --help`                       | discover with `hcloud CES --help` | huawei-cloud-eye |
| CTS tracker                   | discover with `hcloud CTS --help`                       | discover with `hcloud CTS --help` | huawei-cts       |
| DEW secret / KMS key          | discover with `hcloud DEW --help` / `hcloud KMS --help` | discover with `hcloud DEW --help` | huawei-dew       |
| WAF policy                    | discover with `hcloud WAF --help`                       | discover with `hcloud WAF --help` | huawei-waf-aad   |
| IAM users / groups / agencies | discover with `hcloud IAM --help`                       | discover with `hcloud IAM --help` | huawei-iam       |

## Pricing and Balance

- Price per resource: `huawei-billing` skill (ListCosts / ListCustomerBillsFeeRecords family)
- Account balance: `hcloud BSS ShowCustomerAccountBalances --cli-region=cn-north-1 --cli-domain-id=<domain_id>`
  - Global services (BSS/IAM) demand `--cli-domain-id` per call (or in the profile) under AK/SK auth
  - If the domain_id is unknown: extract it from ANY resource response's `tenant_id` field (e.g. a VPC create response) or from the console (My Credentials page)
  - Response shape: `account_balances[].amount` (cash account type=1, voucher account type=5), `debt_amount`, `currency`
- Cost gate rule: no deployment without a per-resource cost estimate AND a balance check. Verified failure mode when skipped: ECS creation dies with `Ecs.7000 Insufficient account balance` at order submission

## Auth Bootstrapping (prerequisite for every command above)

- Symptom of a broken profile: every hcloud API returns `APIGW.0301 Incorrect IAM authentication information` while OBS/obsutil keeps working - caused by a stale `securityToken` in the profile
- Fix: `hcloud configure delete --cli-profile=default`, then re-run `npx huaweicloud-devkit auth init` with permanent AK/SK only (no token). `configure set` refuses empty values, so the token cannot be cleared in place
- project_id is auto-discovered once signing works - no need to configure it manually
- VPC/OBS create responses expose `tenant_id` (= domain_id) - the reliable fallback source when BSS/IAM discovery is blocked
