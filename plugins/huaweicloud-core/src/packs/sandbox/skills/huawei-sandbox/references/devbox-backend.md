# DevBox 后端（HW_SANDBOX_BACKEND=devbox）

> 平台资源池方案。`legacy`（默认）走 DevStation/hwlink；`devbox` 走 hdkitservice `/sandbox/devbox/*` + DevBox EnvD。
> 本文件是 v1 口径；与代码冲突时以代码与实测为准。

## 开关与回退

- `HW_SANDBOX_BACKEND=legacy|devbox`；未知值启动即报错，不做静默回退。
- connect 成功后 workspace→backend 记在进程内；会话中途改 env 不会把已连接 workspace 路由到另一个后端。
- 已存在的 legacy 沙箱不跨后端迁移；回退到 `legacy` 后用 legacy 的 connect 重新接管原 DevStation 实例。
- `HW_SANDBOX_CONNECT_TIMEOUT_SECONDS`：devbox connect/refresh 的默认 TTL（10–86400，默认 1800）。
- 测试专用（生产禁止）：`DEVBOX_TLS_INSECURE=1`、`DEVBOX_TEST_GATEWAY_HOST`、`DEVBOX_TEST_GATEWAY_IP`。只影响 devbox 数据面/控制面；生产必须严格 TLS、真实域名。

## 租户与凭证（A：每次 AK/SK）

- tenant = STS `principal_id`：每个 IAM 子账号独立租户、独立一台 ephemeral 沙箱；主账号自身也是独立租户。`account_id`/domain 只审计，不参与隔离/配额。
- 所有控制面（connect / refresh / shutdown / kill / status）每次都用 AK/SK（+ 可选 `X-HW-Security-Token`）调 hdkitservice；**没有 sandbox key**，没有 key 表/本地 store/多 key/吊销。
- v1 只接受 `principal_urn` 为 `:user:` 的凭证；agency/临时凭证返回 `HDKIT_IDENTITY_UNSUPPORTED`（403）。
- 凭证失效/轮换或 devkit 重启 → 401 `HDKIT_CREDENTIAL_INVALID` → 重新认证（`auth init` / `auth switch`）。`HDKIT_CREDENTIAL_FORBIDDEN`（403）是 IAM 授权问题，不要当过期重登；`HDKIT_IAM_ERROR`（502）是上游 IAM 失败，重试即可。
- 单沙箱 EnvD `connect_token` / `envd_access_token` 只在 devkit 进程内存；不进 tool result/日志/落盘。数据面 401 时自动 refresh + 重试一次（仍失败需要重新认证）。

## 生命周期

| 项       | devbox v1                                                                                    |
| -------- | -------------------------------------------------------------------------------------------- |
| 池类型   | 仅 `ephemeral`；`persistent` → `HDKIT_BACKEND_UNSUPPORTED`，不创建、不静默降级               |
| TTL      | `timeout_seconds`（10–86400，默认 1800）；connect/refresh 延长同一沙箱                       |
| shutdown | = pause；默认保留 168h，暂停仍计入平台 Key 容量                                              |
| kill     | = delete；不可逆，独立工具 + always 审批 + 二次确认；legacy 返回 `HDKIT_BACKEND_UNSUPPORTED` |
| 回收     | 业务层每小时兜底：`paused_at` 超 168h 主动 DELETE；所有软删除路径释放 `active_slot`          |
| 重启复用 | 有效 AK/SK 重新 connect 复用原 sandbox（running/paused）；暂停先 resume                      |
| 账号切换 | 下一次控制面调用用新 AK/SK 重新认证，天然路由到新 tenant                                     |

## 平台 Key 池（服务端）

- 同账号最多 20 个 DevBox API Key，同一 Namespace；每 Key 容量默认 100。Key 只存在 hdkitservice 配置/密钥管理，永不进 devkit。
- create 前原子预留（`devbox_platform_key_usage` 行 + reservation）；失败/删除释放；暂停不释放。
- 沙箱按创建它的 `platform_key_id` 路由，不跨 Key 兜底；Key 不可用 → `HDKIT_DEVBOX_KEY_UNAVAILABLE`（502）。
- 孤儿收养按 metadata `devkit_reservation_id` 幂等，不盲目 `used+1`；stale 清理同事务先 released 再按全集重算 used。
- 同账号 Key 轮换：新 Key active；旧 Key draining（只停新建，已有沙箱继续）。

## 数据面（EnvD one-shot）

- 执行：`POST /process.Process/Start`，非 PTY，`/bin/bash -l -c <command>`，读到 `end`；不实现 `Process/Connect`、`SendInput`、`SendSignal`、PTY。
- 文件：`GET/POST /files?path=<abs>`；upload_project 用 tar.gz + 沙箱内解压。
- 头：`Cookie: relay_token=<connectToken>` + `X-Access-Token` + `E2B-Sandbox-Id` + `E2B-Sandbox-Port: 49983`。
- `exec_with_session` 降级 one-shot，返回 `degraded:true` / `statePersisted:false`；`close_session` not_applicable。
- async 仍用 V2 claim 协议（`exec_one_shot` mode:"async" + `exec_poll`）。

## 预览

- `expose_tunnel` 直接返回应用端口 URL（把 envdUrl 主机的 `-49983` 换成 `-<port>`），不走 DevBridge、不建隧道、不装 keepalive。
- **单端口、默认公开**；应用必须绑定 `0.0.0.0`（`127.0.0.1` 不可达）。
- `expose_poll` / `renew_tunnel` / `keepalive_watchdog` 返回 `HDKIT_BACKEND_UNSUPPORTED` + `reason:"not_applicable"`。

## 模板与 nginx

- 平台支持自定义模板/镜像；我们团队提供含 nginx 的镜像，平台侧配置 template_id。
- `default` 模板没有 nginx：可跑 create/connect/exec one-shot/files/app port；`deploy_nginx` 的真实 E2E 等自定义模板到位后再跑。
- 不做 Python 静态服务器 fallback。

## 常见错误码

| 码                             | HTTP | 处置                                                                |
| ------------------------------ | ---- | ------------------------------------------------------------------- |
| `HDKIT_CREDENTIAL_INVALID`     | 401  | AK/SK 无效/失效 → 重新认证                                          |
| `HDKIT_CREDENTIAL_EXPIRED`     | 401  | 临时凭证过期（v1 保留，未来支持）                                   |
| `HDKIT_CREDENTIAL_FORBIDDEN`   | 403  | IAM 无权限 → 修授权，不是重登                                       |
| `HDKIT_IDENTITY_UNSUPPORTED`   | 403  | agency/临时凭证 → v1 不支持                                         |
| `HDKIT_IAM_ERROR`              | 502  | 上游 IAM 失败 → 稍后重试                                            |
| `HDKIT_CONNECT_IN_PROGRESS`    | 409  | 同租户并发 connect → 稍后重试                                       |
| `HDKIT_DEVBOX_CREATE_FAILED`   | 502  | 平台创建失败，带 request id                                         |
| `HDKIT_DEVBOX_KEY_UNAVAILABLE` | 502  | 平台 Key 容量满/不可用 → 联系运营                                   |
| `HDKIT_CAPACITY_INSUFFICIENT`  | 429  | 平台资源不足 → 错峰                                                 |
| `HDKIT_BACKEND_UNSUPPORTED`    | 400  | 后端不支持该操作（persistent/kill on legacy/credentials/tunnel 类） |
| `HDKIT_SANDBOX_NOT_FOUND`      | 404  | 不存在或跨 tenant（不泄漏存在性）                                   |
