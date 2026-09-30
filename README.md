# Sub2API Quota Monitor

Windows 桌面浮球，查看 sub2api 0.2.8 接入的 Claude、OpenAI 等上游账号的 5 小时与 7 天额度。当前实现：**Electron + Vue 3 + Element Plus + TypeScript**。

## 使用

运行 [Sub2API Quota Monitor.exe](release/v0.3.0/win-unpacked/Sub2API%20Quota%20Monitor.exe)，系统托盘右键打开自绘菜单。浮球右键也可打开同一菜单并进入设置。首次启动显示明确标记的演示账号；在「连接」页填写服务器地址、管理员邮箱和密码，若服务器要求双重验证，再输入 6 位验证码。到「账号」页选择账号并填写浮球别名。

整个浮球区域都可拖动，包括账号名和进度条。拖到当前显示器工作区边缘会收成摘要并轮播账号；悬停查看全部账号和刷新时间。失焦时默认 65% 不透明度，悬停、拖动或查看明细时恢复清晰。设置页包括名称/进度条/贴边宽度、刷新间隔、状态色预览、字号、粗细和 TTF 字体导入。Windows 安装版默认开机自启动，可在「刷新」页关闭。

密码不落盘。记住登录使用 Electron `safeStorage` 在 Windows 当前用户下加密刷新令牌；访问令牌只保留在主进程内存。数据缺失显示 `--`，刷新失败保留成功快照与原时间。

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

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/main` | Electron 窗口、托盘、API、会话与本地存储 |
| `src/renderer` | Vue 3 浮球、明细、右键菜单和 Element Plus 设置 |
| `src/shared` | 配置、额度与跨显示器几何规则 |
| `src/preload` | 受限的渲染进程接口 |
| `tests/electron-*.test.ts` | 显示规则与 sub2api 0.2.8 测试 |
| `scripts/desktop-smoke.cjs` | 实际 Electron 窗口与登录流程验证 |

原 C# / .NET 10 + WPF 代码仍在 `src/QuotaMonitor.Core`、`src/QuotaMonitor.Desktop` 和 `tests/QuotaMonitor.Tests`，并固定在 Git 标签 `wpf-baseline`。当前主线的构建脚本使用 Electron，WPF 代码可单独用 `dotnet build QuotaMonitor.sln -c Release` 编译。

文档：[当前方案](docs/electron-design.md) · [sub2api 接口](docs/api-contract.md) · [验证记录](docs/progress.md) · [WPF 历史方案](docs/design.md)。
