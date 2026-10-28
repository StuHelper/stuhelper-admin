# stuhelper-admin

基于 **Vben Admin v5.7.0 官方默认 web-antd 应用**的 StuHelper 管理端框架，组件库为 Ant Design Vue。当前提供官方布局、平台状态、评价审核、审核规则和课程教师资料更正。真实身份接入仍由后端提供。

## 本地开发

需要 Node.js 24.22.1 和 pnpm 10.33.4。make setup 使用 pnpm-lock.yaml 安装固定依赖，CI 通过 packageManager 字段读取 pnpm 版本。

```bash
make setup
make check
make dev
```

默认监听 127.0.0.1:5174，API 代理为 127.0.0.1:8080，通过 STUHELPER_API_TARGET 配置。setup 只在缺失时复制 .env.example 为被 Git 忽略的 .env，不覆盖已有文件。

## 上游与本地改动

来源 tag 和精确提交记录在 vendor/vben.json，上游 MIT 许可证保存在 LICENSES/Vben-MIT.txt。内部 packages、internal 与 pnpm workspace 保留 Vben 的共享组件组织方式，业务仓库仍按 StuHelper 的多仓库边界维护。

仅保留 web-antd 应用，移除其他 UI 应用、演示页面、Mock 后端和上游统计脚本。保留官方布局、主题、表单适配、国际化和共享组件。主应用不伪造用户、角色、通知或业务统计。

为了修复实际安装检查中的兼容问题，构建工具固定 tsdown/@tsdown/css 0.23.2 和 vite-plugin-vue-devtools 8.2.1。原 skipNodeModulesBundle 配置使用当前 neverBundle 选项表达，继续生成并检查类型声明。同时固定兼容 Vite 8 的 inspect 依赖和 unplugin-dts 1.1.2。移除未使用的 Git hook 自动安装依赖。完整工具链通过 pnpm-lock.yaml 固定。

## 身份和权限边界

公开框架页与管理页面使用同一布局。管理页面访问 `/api/v1/reviews/admin`、moderation 和 catalog 接口，服务端逐次检查学校权限。认证失败时清除旧结果，不能通过页面路由或本地 accessToken 取得权限。

当前不提供本地账号密码登录、演示账号或 OAuth client secret。后续统一登录通过独立官方 SSO 接入。

## 业务入口

`/academic/reviews` 提供待审与申请队列、内容管理及审核规则。管理员可以查看原文、隐藏、恢复、删除、修改正文和讨论身份。决定保存后显示等待执行，只有服务端确认 applied 才展示已执行。

`/academic/catalog` 提供按学校查询课程与教师，并更正名称、简介、院系及课程分类。缺失学分可保持未知。版本冲突保留输入，加载当前版本后再由管理员确认保存。

## 契约与检查

contracts/platform.openapi.yaml 与生成类型来自 platform 仓库。scripts/contracts 独立固定接口生成工具使用的 TypeScript 5，不改变 Vben 应用的 TypeScript 6 工具链。`contracts/platform.source.json` 记录契约来源。课程、评价与审核的 OpenAPI 和生成类型同样记录来源、提交和摘要，并检查生成一致性。工作区检查核对来源提交及提供方兼容性。

make check 执行八语言覆盖检查、类型检查、应用 lint、单元测试与生产构建。中文为默认语言，支持英文、法文、俄文、日文、韩文、西班牙文和阿拉伯文。金额、数字、日期与复数由统一格式接口处理，阿拉伯文布局使用 RTL。学生端和管理端的 208 项八语言桌面与移动浏览器检查在架构仓库维护，使用合成响应。真实登录与生产运行分别验收。

架构与业务规格见 [StuHelper Next](https://github.com/StuHelper/stuhelper-next)。
