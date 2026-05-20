# himan 错误码说明

本文档面向 CLI 使用者与自动化脚本维护者，说明 `himan` 的错误码、典型触发场景和建议处理方式。

## `--json` 错误输出格式

当命令带 `--json` 且执行失败时，CLI 会输出结构化错误（输出到 `stderr`）。  
该规则同时覆盖：

- 命令执行业务错误（如资源不存在）
- 参数/命令解析错误（如缺参数、未知命令）

输出格式：

```json
{
  "ok": false,
  "error": {
    "code": "E_RESOURCE_NOT_FOUND",
    "message": "Resource not found: rule/code-review",
    "details": {
      "key": "value"
    }
  }
}
```

字段说明：

- `ok`: 固定为 `false`
- `error.code`: 稳定错误码，建议脚本优先按此分流
- `error.message`: 人类可读错误信息
- `error.details`: 可选，附加上下文

## 错误码列表

### `E_CONFIG_NOT_FOUND`

- **含义**：未找到源配置。
- **常见触发**：首次使用前直接执行 `list/install/dev/publish`。
- **建议处理**：先执行 `himan init <git_repo>`，或检查 `~/.himan/config.json` 是否存在。

### `E_NOT_IMPLEMENTED`

- **含义**：功能已预留但尚未实现。
- **常见触发**：使用 registry 相关路径。
- **建议处理**：改用 Git source；关注后续版本计划。

### `E_INVALID_INPUT`

- **含义**：输入参数不合法。
- **常见触发**：source 名称不符合 kebab-case、git source 未提供 repo、install mode 不是 `link|copy`、agent 名称不支持等。
- **建议处理**：按命令帮助修正参数格式。

### `E_RESOURCE_NOT_FOUND`

- **含义**：资源或来源不存在。
- **常见触发**：安装不存在的资源、切换到不存在的 source 名称、发布目标资源不存在。
- **建议处理**：先执行 `himan list <type>` / `himan source list` 确认名称。

### `E_RESOURCE_ARCHIVED`

- **含义**：资源已归档，默认不允许作为 active 资源继续使用。
- **常见触发**：直接安装或发布已归档资源，或重复归档已经在 `archive/<plural>/<name>` 下的资源。
- **建议处理**：如需继续维护，先执行 `himan resource restore <type> <name>`；如只需安装历史版本，显式传 `--include-archived`。

### `E_VERSION_NOT_FOUND`

- **含义**：指定版本不存在。
- **常见触发**：`install <type> <name@version>` 中版本号不在 tag 历史内。
- **建议处理**：先执行 `himan history <type> <name>` 查看可用版本。

### `E_INSTALL_NOT_FOUND`

- **含义**：项目内未找到已安装目标。
- **常见触发**：未安装直接 `dev`、或手动删除了 `.cursor/*/<name>` 等安装目标。
- **建议处理**：先重新执行 `himan install <type> <name[@version]>`。

### `E_LOCK_NOT_FOUND`

- **含义**：未找到 lock 文件，或 lock 中无资源可恢复。
- **常见触发**：项目未生成 `himan.lock` 就执行 `himan install`（无参数）。
- **建议处理**：先安装至少一个资源以生成 lock，或检查 `himan.lock` 路径。

### `E_LOCK_INVALID`

- **含义**：`himan.lock` 存在但格式不合法。
- **常见触发**：手动编辑导致 JSON 结构损坏、`version/resources` 字段异常。
- **建议处理**：修复 lock JSON，或删除后重新通过 `install <type> <name[@version]>` 生成。

### `E_CLI_USAGE`

- **含义**：CLI 参数或命令解析错误（Commander 层）。
- **常见触发**：缺少必填参数、未知命令、未知选项。
- **建议处理**：检查命令拼写与参数数量，使用 `himan <command> --help` 查看正确用法。
- **附加信息**：`error.details.commanderCode` 可用于进一步区分错误类别（如 `commander.missingArgument`）。

### `E_RESOURCE_EXISTS`

- **含义**：资源已存在，无法重复创建。
- **常见触发**：重复执行 `create <type> <name>`。
- **建议处理**：改名，或显式使用 `--force`。

### `E_TEMPLATE_NOT_FOUND`

- **含义**：模板不存在。
- **常见触发**：`create` 使用了不支持的模板名。
- **建议处理**：使用当前支持模板（默认 `basic`）。

### `E_INVALID_RESOURCE_NAME`

- **含义**：资源名不符合命名规则。
- **常见触发**：使用非 kebab-case 的名称。
- **建议处理**：改为 `kebab-case`（如 `code-review`）。

### `E_INVALID_RESOURCE_METADATA`

- **含义**：资源元数据不合法，无法发布、读取为有效资源，或无法解析为可安装的依赖信息。
- **常见触发**：`himan.yaml` 存在但 `name/type/entry` 不匹配，`entry` 指向的入口文件不存在，缺少 `himan.yaml` 且默认入口文件也不存在，或 `analysis.dependencies.skills` 结构非法/存在循环依赖。
- **建议处理**：如果使用 `himan.yaml`，确认 `name`、`type`、`entry` 与命令参数和文件结构一致；若使用 `install skill ... -r [--depth <n>]`，再额外确认 `analysis.dependencies.skills` 为合法数组，且在实际递归深度范围内不存在环；如果暂不使用 `himan.yaml`，确认默认入口文件存在：`rule` / `command` 为 `content.md`，`skill` 为 `SKILL.md`。

### `E_PUBLISH_NO_CHANGES`

- **含义**：发布时没有可提交的资源变更。
- **常见触发**：重复发布与最新已发布版本内容一致的资源目录；`himan.yaml` 中仅版本字段不同也会视为无内容变化。
- **建议处理**：确认资源内容或元数据已经变更，再重新执行 `publish`。

### `E_UNSUPPORTED_RESOURCE_TYPE`

- **含义**：资源类型不受支持。
- **常见触发**：输入了 `rule|command|skill|config` 之外的类型。
- **建议处理**：修正类型为 `rule`、`command`、`skill` 或 `config`。注意 `config` 当前仅支持 Codex。

### `E_UNKNOWN`

- **含义**：未映射到业务错误码的通用异常。
- **常见触发**：程序运行期意外错误、普通 `Error` 抛出。
- **建议处理**：保留完整命令与错误文本，提交 issue 或定位堆栈来源。
