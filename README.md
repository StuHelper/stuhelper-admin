# stuhelper-admin

基于 **Vben Admin v5.7.0 官方默认 web-antd 应用**的 StuHelper 管理端框架，组件库为 Ant Design Vue。当前提供官方布局、主题、平台状态页、存储运营管理和贡献管理。真实应用登录仍待接入。

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

框架首页不展示业务数据。/storage 和 /contributions 页面只在受保护的服务端 API 返回成功后显示脱敏账本。未登录或权限不足时展示明确错误并清空旧数据，不使用本地角色、演示账号或手工 token 绕过服务端授权。

请求复用同源认证传输。当前 backend 要求有效的 Bearer 访问令牌，浏览器登录与认证传输尚未装配，默认页面显示未登录或不可用。存储页面实现与显式测试夹具不表示真实登录完成，Next SSO 配置保持不动。

当前不提供本地账号密码登录、演示账号或 OAuth client secret。后续统一登录通过独立官方 SSO 接入。

## 契约与检查

platform、storage 和 contribution 接口分别从提供方 OpenAPI 生成类型。contracts 中的 source.json 记录提供方提交、版本、摘要与映射，make check 验证存储生成结果。存储共享样例来自提供方，客户端校验时间、整数范围、分页上限和响应字段。

make check 执行八语言覆盖检查、类型检查、应用 lint、单元测试与生产构建。中文为默认语言，支持英文、法文、俄文、日文、韩文、西班牙文和阿拉伯文。金额、数字、日期与复数由统一格式接口处理，阿拉伯文布局使用 RTL。存储浏览器检查使用明确 HTTP 夹具覆盖八语言、桌面和移动布局、键盘确认、未知结果重试、分页及撤权清空。真实身份与供应商联调另行验收。

架构与业务规格见 [StuHelper Next](https://github.com/StuHelper/stuhelper-next)。

## 存储运营管理

实例页展示平台额度、已用、预占、可写容量和授权截止时间，支持暂停新写、恢复暂停、排空、撤销与额度调整。页面按状态提供操作提示，实际资格和权限由服务端判定。撤销后重新授权不由恢复按钮处理。

对象与失败任务分别按游标分页，每页最多 25 条。确认操作携带当前修订或代次与幂等键。网络失败或响应不确定时保留原请求，只能重试原请求；未登录或无权限立即清除已展示业务数据。容量等整数超出 JavaScript 安全整数范围时拒绝展示，避免静默舍入。

运行 make build 后执行 make storage-browser。Playwright 固定为 1.64.1，以支持 Ubuntu 26.04，首次运行先执行 pnpm exec playwright install --with-deps chromium。浏览器夹具仅存在于 tests/e2e，不打包进应用，也不连接真实存储账号。

## 存储贡献管理

/contributions 使用独立管理权限查看脱敏贡献状态、用户请求、容量、授权失败和退出迁移。管理员只能重试阻塞的原请求，不能借重试修改用户同意、期限、额度或撤权决定。普通贡献权限和后台服务身份不能使用管理接口。

提供方维护贡献浏览器 SDK，快照校验覆盖源码摘要和生成类型。make storage-browser 同时执行存储与贡献页面的八语言、桌面/移动检查，验证未知结果原键重试、分页和权限撤销。测试使用显式 HTTP 夹具，不开放真实贡献。

贡献截图按需存放在 CONTRIBUTION_SCREENSHOTS 指定的任务目录，默认关闭；每轮最多 16 张、总计不超过 20 MiB，人工检查后删除。浏览器 test-results 仅保留本机本轮报告，任务结束清理，不上传 CI 制品或扩大缓存。
