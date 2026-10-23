# StuHelper Admin

基于 **Vben Admin v5.7.0 官方默认 web-antd 应用**的 StuHelper 管理端框架，组件库为 Ant Design Vue。当前提供官方布局、主题、组件适配和平台服务状态页，业务管理及真实身份接入尚未实现。

## 本地开发

需要 Node.js 24 和 Corepack。项目固定 pnpm 10.33.4，make setup 在 .tools/bin 创建局部 Corepack 入口，不修改全局 pnpm。

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

当前公开路由只展示无业务数据的框架页面。管理接口依赖真实身份适配器，未接入时显示身份服务尚未接入。新增业务路由默认不可访问，不能通过 Vben 演示 roles 或本地 accessToken 取得服务端权限。

当前不提供本地账号密码登录、演示账号或 OAuth client secret。后续统一登录通过独立官方 SSO 接入。

## 契约与检查

contracts/platform.openapi.yaml 与生成类型来自 platform 仓库。scripts/contracts 独立固定接口生成工具使用的 TypeScript 5，不改变 Vben 应用的 TypeScript 6 工具链。工作区检查会核对提供方和客户端快照。

make check 执行 Admin 类型检查、应用 lint、单元测试与生产构建。业务与真实登录验收在实现后单独执行。

架构与业务规格见 [StuHelper Next](https://github.com/StuHelper/stuhelper-next)。
