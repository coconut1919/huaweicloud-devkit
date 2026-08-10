# Hook 规则模型

华为云插件的 Hook 安全能力用于帮助 Agent 在执行命令、生成云资源配置、创建沙箱或预览环境之前，发现常见的高风险用云问题。

这不是一个后台服务，也不需要额外部署。它是插件内置的本地规则能力。

## 规则目录

公开规则位于：

```text
plugins/huaweicloud-core/safety/rules/cloud-risk-rules.json
```

每条规则包含：

- `id`：稳定的公开规则编号，例如 `hwc-network-public-admin-port`。
- `category`：风险类型，例如凭据、密钥、公网暴露、IAM、成本、删除、沙箱、配置错误。
- `severity`：处理级别，取值为 `deny`、`warn`、`info`。
- `stages`：适用阶段，取值为 `command`、`artifact`、`deploy_plan`。
- `match`：确定性匹配条件。
- `message`：给 Agent 和用户看的风险说明。
- `remediation`：可执行的修复建议。

## 检查阶段

| 阶段 | 用途 | 推荐工具 |
|------|------|----------|
| `command` | 检查准备执行的 Shell 或 KooCLI 命令 | `huaweicloud_hook_check_command` |
| `artifact` | 检查生成的代码、IaC、策略、配置文件 | `huaweicloud_hook_check_artifacts` |
| `deploy_plan` | 检查沙箱、预览环境、云资源部署计划 | `huaweicloud_hook_check_deploy_plan` |

## 判断结果

- `deny`：停止执行，先修复风险。
- `warn`：提示用户或修复后继续。
- `info`：记录提示，不阻塞。
- `allow`：没有命中风险规则，可以继续进入后续审批或执行流程。

## 执行链路

1. Skill 先教 Agent 如何安全使用华为云。
2. MCP 工具让 Agent 在执行前主动检查命令、文件或部署计划。
3. 支持 Hook 的 Agent Host 会在工具执行前调用 `hooks/huaweicloud-safety.py`。
4. KooCLI 安全包装器继续执行只读/写操作审批、输出脱敏等已有保护。

## 隐私边界

公开插件仓只保存通用化安全规则。

不能提交：

- 内部账号名。
- 内部漏洞单编号。
- 原始漏洞描述。
- 原始复现步骤。
- 内部评论原文。
- 内部样本文件。

内部样本只能用于离线分析。进入插件仓的内容必须被泛化成公开规则，例如“公网开放管理端口”或“OBS 匿名写权限”，不能携带来源痕迹。

维护者可以在本地设置 `HUAWEICLOUD_DEVKIT_PRIVATE_MARKERS` 做发布前扫描。这个变量里的具体值不应提交到仓库。

## 规则编写原则

- 优先写可泛化的风险模式，不写某个具体工单的复刻。
- 每条规则必须给出 Agent 能执行的修复建议。
- `deny` 只用于高确定性、高危风险。
- `warn` 用于需要用户确认或补充上下文的风险。
- 新规则必须配套测试。
- 证据片段必须脱敏，不能把 AK/SK、token、密码写回上下文。
