# Sub2API Quota Monitor

Windows 桌面浮球，查看 sub2api 0.2.8 接入的 Claude、OpenAI 等上游账号的 5 小时与 7 天额度。当前实现：**Electron + Vue 3 + Element Plus + TypeScript**。

## 使用

运行 [Sub2API Quota Monitor.exe](release/v0.4.6/win-unpacked/Sub2API%20Quota%20Monitor.exe)，系统托盘右键打开自绘菜单，设置、刷新和更新等操作统一从此进入；浮球右键不弹出菜单。托盘菜单在任务栏上方留出 8 DIP 间距，等待内容就绪后单次显示；按钮可直接点击，点击菜单外、任务栏或切换应用后自动收起。首次启动显示明确标记的演示账号；在「连接」页填写服务器地址、管理员邮箱和密码，若服务器要求双重验证，再输入 6 位验证码。到「账号」页选择账号并填写浮球别名。

“账号”页也显示可用重置次数，有次数时显示“重置额度”。点击后确认账号及消耗一次重置机会，才会执行。没有重置卡时隐藏按钮；影子账号需在母账号操作。

整个浮球区域都可拖动，包括账号名和进度条。拖动时固定逻辑宽高，避免 175% 等非整数缩放下长按持续增大。拖到当前显示器工作区边缘会收成摘要并轮播账号；悬停查看全部账号和刷新时间。失焦时默认 65% 不透明度，悬停、拖动或查看明细时恢复清晰。设置页包括名称/进度条/贴边宽度、刷新间隔、状态色预览、字号、粗细和 TTF 字体导入。Windows 安装版默认开机自启动，可在「刷新」页关闭。

密码不落盘。记住登录使用 Electron `safeStorage` 在 Windows 当前用户下加密刷新令牌；访问令牌只保留在主进程内存。数据缺失显示 `--`，刷新失败保留成功快照与原时间。

安装版启动时检查一次 GitHub Releases，之后默认每 10 分钟检查一次。在「刷新」页的「版本检查间隔」可修改为 1–10080 分钟，保存后立即调整定时器，重启后保留。发现新版时托盘图标右上角出现红点，右键菜单显示更新项；确认后才下载，下载完成后再次确认才重启安装。没有新版本时不显示红点和更新项。开发版不访问更新服务。

托盘菜单的「检查更新…」可立即查询新版本；发现新版时同一项变为「更新到 v…」，不另加一行。「关于 Sub2API」打开自绘面板，显示名称、实际运行版本和项目主页。发行内容与后续待发布修改见 [更新记录](docs/pending-changes.md)。

## 开发

需要 Windows 10/11 x64、Node.js 22.12+ 和 npm：

```powershell
npm ci
npm run icons
npm run dev
```

`npm run dev` 启动 Vite 和 Electron 桌面窗口。构建、测试和打包：

```powershell
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run pack
```

`npm run pack` 输出 `release/win-unpacked/Sub2API Quota Monitor.exe`，运行时须保留同目录其余文件。`npm run dist:win` 构建安装程序。`npm run test:desktop` 使用隔离的临时配置和本地模拟 sub2api 服务，截图及报告写入 `artifacts/electron-smoke/`；不会连接用户服务器。

后续版本使用固定流程，以下以准备下一版 `0.4.7` 为例，完整说明见 [Windows 打包与更新发布](docs/releasing.md)：

只有用户明确要求发布热更新时才上传或正式发布 Release，发布前先核对并说明本次更新内容。日常修改只完成本地开发和验证。

```powershell
npm run release:prepare -- --version 0.4.7
# 提交本次代码和版本文件，并推送到 main 后：
npm run release:draft -- --version 0.4.7
```

第一条命令调整版本、测试、打包、校验并归档到 `release/v0.4.7/`；第二条命令上传 GitHub Release 草稿，最后在 GitHub 点击 **Publish release**。客户端启动时、此后默认每 10 分钟检查正式版本，提示后由用户确认下载与安装。`npm run release:verify -- --version 0.4.6` 可再次核对当前产物。安装包目前未做数字签名。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/main` | Electron 窗口、托盘、API、会话与本地存储 |
| `src/renderer` | Vue 3 浮球、明细、右键菜单和 Element Plus 设置 |
| `src/shared` | 配置、额度与跨显示器几何规则 |
| `src/preload` | 受限的渲染进程接口 |
| `tests/electron-*.test.ts` | 显示规则与 sub2api 0.2.8 测试 |
| `scripts/desktop-smoke.cjs` | 实际 Electron 窗口与登录流程验证 |
| `scripts/release.cjs` | 版本调整、测试、Windows 打包校验与 Release 草稿上传 |

原 C# / .NET 10 + WPF 代码仍在 `src/QuotaMonitor.Core`、`src/QuotaMonitor.Desktop` 和 `tests/QuotaMonitor.Tests`，并固定在 Git 标签 `wpf-baseline`。当前主线的构建脚本使用 Electron，WPF 代码可单独用 `dotnet build QuotaMonitor.sln -c Release` 编译。

文档：[当前方案](docs/electron-design.md) · [sub2api 接口](docs/api-contract.md) · [验证记录](docs/progress.md) · [WPF 历史方案](docs/design.md)。
