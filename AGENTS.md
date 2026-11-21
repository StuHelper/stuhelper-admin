---
updated: 2026-11-21
---

# 工程约定

本仓库维护 StuHelper 管理端。架构、模块职责、业务术语与交付约定见[根仓工程约定](https://github.com/StuHelper/stuhelper/blob/develop/AGENTS.md)。

## 工作区与交付

- 从最新 `origin/develop` 创建短期分支，在 `workspace/worktrees/<任务>/<仓库名>` 独立工作。保留其他任务的改动。PR squash 合入 develop。
- 正式发行从 develop 合并至 main。tag、镜像发行和生产晋级须经负责人授权。Actions、发行制品与部署镜像使用明确版本，提交和摘要用于核验。
- 普通 CI 和公开应用 GHCR 镜像发行使用托管 `ubuntu-26.04`。管理端工作流按锁文件安装依赖，公开 PR 只恢复共享缓存，可信分支运行可保存。详见[CI 规格](https://github.com/StuHelper/stuhelper/blob/develop/docs/spec/ci-runners.md)。
- Docker 测试使用任务专属资源，完成、失败或中断时清理本任务的容器和闲置制品。保留其他任务资源与持久数据。

## 接口、界面与验证

- 接口以提供方 OpenAPI 为准，通过 `make generate` 更新类型。契约来源与摘要随快照记录。服务端执行身份与业务授权，页面按结果显示状态。凭据、身份原始数据和敏感样本仅使用获准的私有环境。
- 新增界面文案使用翻译键，覆盖八种语言和阿拉伯语 RTL。日期、数字、金额和复数采用公共接口。显示云盘业务时使用「云盘」术语。详见[国际化规格](https://github.com/StuHelper/stuhelper/blob/develop/docs/spec/internationalization.md)。
- 用 `make check` 执行仓库检查，针对受影响页面执行相应浏览器用例。以 `module.json` 的 `scenario_tests` 登记新实现的规格场景和实际测试名称。检查失败时修复后重跑原检查。
- 分别记录源码检查、真实账号验收、发行和部署结果。涉及真实账号与生产数据时遵循根仓授权范围。

## 文档维护

- 文档直接描述当前实现、验证结果和剩余工作。业务规则变化时同步更新对应主题和 `updated` 日期，删除过时与重复内容。正文单段最多 200 个可见字符。
- 使用具体的中文和准确的技术术语。长期技术文档使用相关写作技能，待确认的产品选择保留 InReview。详见[文档维护约定](https://github.com/StuHelper/stuhelper/blob/develop/docs/authoring.md)。
