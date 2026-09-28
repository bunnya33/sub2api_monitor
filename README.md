# Sub2API Quota Monitor

C# / .NET 10 / WPF 的 Windows 桌面客户端。显示 Claude、OpenAI 等上游账号的 5 小时和 7 天额度，支持托盘、置顶浮窗、四边吸附、账号轮播与悬停明细。接口目标版本：**sub2api 0.2.8**。

## 开发

需要 Windows 10/11 x64 和 .NET 10 SDK。直接打开 `QuotaMonitor.sln`，或运行：

```powershell
dotnet build QuotaMonitor.sln -c Release
dotnet test QuotaMonitor.sln -c Release
dotnet run --project src/QuotaMonitor.Desktop
```

设置从系统托盘图标的右键菜单打开。首次启动打开连接页，填入自己的 sub2api 地址与管理员邮箱、密码。开启双重验证时再输入 6 位验证码，登录后在「账号」页选择监控对象。密码只用于本次登录。未连接服务器时可开启演示模式，示例账号带有「示例」标记。

浮球默认失焦不透明度 65%，悬停、拖动和查看明细时恢复至 100%。设置可修改透明度或关闭淡化。浮球和明细不主动抢占当前应用的输入焦点。

原生窗口自动验证使用隔离配置，期间会短暂移动鼠标并恢复原位。报告与截图保存在 `artifacts/wpf-smoke/`：

```powershell
dotnet run --project src/QuotaMonitor.Desktop -c Release -- --smoke-test

# 自包含版本，目标电脑无需安装 .NET。
powershell -File scripts/publish.ps1

# 较小版本，目标电脑需要 .NET 10 Desktop Runtime。
powershell -File scripts/publish.ps1 -FrameworkDependent
```

可执行文件为 `release/win-x64/Sub2APIQuotaMonitor.exe`。当前交付为直接运行的 x64 应用，尚未制作安装程序、签名、自动升级和开机自启。

`src/QuotaMonitor.Core` 负责数据、API、刷新调度和几何规则；`src/QuotaMonitor.Desktop` 负责 WPF 窗口、托盘、透明度、原生吸附及 DPAPI；`tests/QuotaMonitor.Tests` 包含自动化测试。

## 文档

- [产品与技术方案](docs/design.md)
- [已核对的 sub2api 接口](docs/api-contract.md)
- [开发进度与验收记录](docs/progress.md)

配置与 Windows DPAPI 加密的刷新会话保存在 `%LOCALAPPDATA%/Sub2APIQuotaMonitor/`。可用 `QUOTA_DATA_DIR` 指定独立配置目录，`QUOTA_SMOKE_DIR` 指定验证报告目录。额度接口不存在的窗口显示 `--`，失败时保留原成功数据和时间。服务器地址与账号信息不写入 Git。
