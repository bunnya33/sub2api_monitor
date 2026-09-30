# Windows 打包与更新发布

后续每个正式版本都按以下流程发布。客户端更新的是完整的 Electron Windows 应用，前端和桌面逻辑一起更新。

## 首次准备

在 Windows 上安装 Node.js 22.12 或更高版本、Git，在项目目录执行：

```powershell
npm ci
```

如果要用脚本上传 GitHub Release 草稿，另安装 GitHub CLI 并登录一次：

```powershell
winget install --id GitHub.cli
gh auth login
```

安装 GitHub CLI 后可能需要重新打开终端。不使用 GitHub CLI 时，也可以在 GitHub 网页手动上传发布文件。

## 1. 一条命令准备发布包

例如当前版本是 `0.4.5`，准备下一版 `0.4.6`：

```powershell
npm run release:prepare -- --version 0.4.6
```

脚本依次执行：

1. 同步 `package.json` 和 `package-lock.json` 的版本号。
2. 运行类型检查和单元测试。
3. 生成图标、构建 Electron/Vue、生成 Windows x64 安装包。
4. 核对更新清单的版本、附件名、文件大小和 SHA-512，并检查程序内置版本。
5. 用生成的免安装版执行桌面自动化测试，使用临时配置和模拟服务器。
6. 保存构建记录，将通过检查的产物归档到 `release/v0.4.6/`。

任何检查失败都会停止。临时产物保存在 `.data/release-preparation/`，截图和测试报告保存在 `artifacts/`。打包不会自动上传 GitHub；脚本不提交代码、不创建 Git 标签、不修改已存在的版本目录。

输出目录中有以下文件：

| 文件 | 用途 |
| --- | --- |
| `Sub2API-Quota-Monitor-Setup-0.4.6.exe` | Windows 安装包，供首次安装和升级 |
| `Sub2API-Quota-Monitor-Setup-0.4.6.exe.blockmap` | 更新器用的差分下载信息 |
| `latest.yml` | 更新器读取的版本、附件名、大小及校验值 |
| `win-unpacked/` | 本地验证用的免安装版，需保留整个目录 |
| `release-record.json` | 发布脚本的源码摘要、文件校验值和测试记录 |

再次检查已生成的文件：

```powershell
npm run release:verify -- --version 0.4.6
```

版本目录已存在时，脚本会停止，保留原产物。确需重建尚未发布的同一版本时，可以指定新目录，后续命令使用相同的 `--output`：

```powershell
npm run release:prepare -- --version 0.4.6 --output release/v0.4.6-rebuild
```

正式版只接受 `0.4.6` 这样的版本号，不带 `v`，不含 `beta`。已经对外发布的版本有修改时，使用新的版本号。

## 2. 提交并推送对应代码

把本次功能代码及两个版本文件提交并推送到 `main`。若功能代码已提交，只剩版本调整：

```powershell
git add package.json package-lock.json
git commit -m "Release v0.4.6"
git push origin main
```

从打包完成到创建草稿之间，项目文件应保持相同内容；提交和推送不会改变文件内容。如果继续修改代码或文档，重新打包，确保草稿指向的提交与安装包一致。

## 3. 上传 GitHub Release 草稿

```powershell
npm run release:draft -- --version 0.4.6
```

脚本检查源码与构建记录一致、工作区干净、当前提交已同步到 `origin/main`，然后在 `bunnya33/sub2api_monitor` 创建 `v0.4.6` 草稿，并上传同一次构建的安装包、blockmap 和 `latest.yml`。默认由 GitHub 生成更新说明。

先预览动作，或指定自己写的更新说明：

```powershell
npm run release:draft -- --version 0.4.6 --dry-run
npm run release:draft -- --version 0.4.6 --notes docs/release-notes.md
```

`--dry-run` 只检查本地构建记录并显示计划，不创建草稿，也不要求安装 GitHub CLI；正式执行时仍需提交、推送并登录 GitHub。`--notes` 文件应在打包前准备好；如果放在被 Git 忽略的发布目录中，也可以在打包后填写。

最后打开 [GitHub Releases](https://github.com/bunnya33/sub2api_monitor/releases)，确认更新说明和三个附件，保留正式版本选项，不勾选预发布，点击 **Publish release**。上传草稿后，客户端还不会提示更新。

若用网页手动发布：选择已经推送的对应提交，标签填写 `v0.4.6`，上传上表前三个文件。不要重命名附件，也不要混用不同构建的文件。`win-unpacked/` 和 `release-record.json` 无需上传。

## 客户端什么时候收到更新

1. v0.4.5 起，Windows 安装版启动时检查一次 GitHub Releases，此后默认每 10 分钟检查一次；「刷新」页的「版本检查间隔」可修改为 1–10080 分钟，保存后立即生效。旧版 v0.4.4 启动约一分钟后检查，此后每 12 小时检查。
2. 发现高于已安装版本的正式 Release 后，托盘图标出现红点，右键菜单显示“更新到 v…”。
3. 用户点击更新并确认，才开始下载。
4. 下载完成后，菜单变为“重启安装”；再次确认后退出、安装新版并重新启动。

Git 提交和推送只更新源码，正式 Release 才向客户端提供更新。开发模式不检查线上更新；旧 `0.3.0` 客户端需先手动安装 `0.4.0` 或更新版本。安装包目前未签名。

## 常见问题

- **打包失败**：查看命令输出和 `artifacts/` 中的桌面报告，修复后再次运行准备命令。成功归档前不会生成正式版本目录。
- **提示源文件变化**：构建后又改了文件，重新准备安装包，并让草稿使用新产物目录。
- **提示当前提交未推送**：先提交、推送；如果 `main` 已被其他提交更新，先同步再准备发布包。
- **GitHub 已存在同名 Release**：脚本停止，不覆盖已有版本。已有草稿可在网页检查并补齐附件；正式版本修复请升版本号。
- **用户看不到新版**：检查 Release 是否正式发布、版本号是否更大、是否上传了 `latest.yml`，以及客户端是否能访问 GitHub。更新检查失败会在主进程记录日志，当前界面没有手动检查按钮。

`scripts/publish.ps1` 保留给 WPF 历史实现使用；Electron 主线使用 `scripts/release.cjs`。
