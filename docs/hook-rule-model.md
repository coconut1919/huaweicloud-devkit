# Hook 规则模型

PreToolUse 钩子在代理工具执行前拦截高危操作，是华为云安全架构的第一道防线。

## 隐私边界

钩子拦截以下隐私泄露路径：

- **凭证文件读取**: 读取 `.hcloud/config`、`.huaweicloud/credentials` 等本地凭证文件
- **环境变量泄露**: 导出包含 `HUAWEICLOUD`、`HWC_`、`HCLOUD`、`OS_` 前缀的云凭证环境变量
- **密钥明文获取**: 直接调用 `ShowSecretVersion` / `GetSecretValue` 获取密钥明文
- **未审批写入**: 通过 hcloud 执行未经用户审批的创建/删除/修改操作（Bash 工具通道）

## 支持的钩子检查 MCP 工具

以下 MCP 工具让代理在提交计划或生成产物后主动检查安全性，无需实际调用 Bash 工具：

### huaweicloud_hook_check_command

检查计划执行的 Shell 或 hcloud 命令，匹配凭证泄露、密钥读取、未审批写入等风险规则。

### huaweicloud_hook_check_artifacts

检查生成的代码、IaC 模板、策略文件或配置产物，匹配 IAM 过度授权、OBS 公开读写、安全组高危端口等风险规则。

### huaweicloud_hook_check_deploy_plan

检查结构化或文本形式的部署计划，匹配沙箱缺少 TTL、公网暴露、IAM 管理员策略、无界成本等风险规则。
