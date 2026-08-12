# Hook 规则模型

PreToolUse hook 在 agent 工具执行前拦截高风险操作。本文件描述 hook 的规则判断模型与隐私边界。

## 隐私边界

Hook 将以下数据流视为穿过隐私边界的操作，直接拒绝（`permissionDecision: "deny"`）：

1. **读取凭证文件**：任何访问 `.hcloud`、`.huaweicloud`、`hcloud/config`、`huaweicloud/config` 路径的命令。
2. **导出环境变量**：`env`、`printenv` 等命令中包含 `HUAWEICLOUD`、`HWC_`、`HCLOUD`、`OS_` 前缀的变量。
3. **直接获取密钥值**：调用 `ShowSecretVersion` 或 `GetSecretValue` 等 API 会把明文密钥泄漏到 agent 上下文。

这些检查在 `hooks/huaweicloud-safety.py` 中以正则表达式实现，策略词汇定义在 `safety/policy.json`。

## 规则判断流程

### 1. 凭证文件拦截

匹配 `CONFIG_FILE_RE` 正则，命中即 deny。

### 2. 环境变量导出拦截

匹配 `ENV_DUMP_RE` 正则，命令中包含环境变量导出工具且目标包含云凭证前缀时 deny。

### 3. 密钥读取拦截

匹配 `SECRET_READ_RE` 正则，调用获取密钥的 API 操作时 deny。

### 4. 云风险规则评估

`cloud-risk-rules.json` 中的 command 阶段 deny 规则按 `all`（全部满足）、`any`（任一满足）、`none`（均不满足）逻辑匹配命令文本，命中即 deny。

### 5. 未授权写操作拦截

当工具为 `Bash` 且命令包含 `hcloud` 及写操作前缀（Create/Delete/Update/Modify/Resize/Reboot/Stop/Start/Restart 等）且无只读操作前缀（List/Show/Get/Describe）时 deny。

## huaweicloud_hook_check_command

`huaweicloud_hook_check_command` 是 MCP 工具层的前置检查接口，允许 agent 在执行命令前主动评估风险。它与 Python hook 共享同一套 `safety/policy.json` 词汇和 `cloud-risk-rules.json` 风险规则，确保非 hook 平台（OpenCode、Codex）也能获得一致的安全判定。

输入待执行的命令文本，返回：
- `allowed: true` — 命令安全，可以执行
- `allowed: false` + `reason` + `remediation` — 命令被拦截，附带原因与修复建议

## 规则扩展

新增风险规则只需更新 `safety/rules/cloud-risk-rules.json`，Python hook 和 MCP 工具会同时加载，无需修改代码。
