const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const yaml = require('js-yaml');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const executable = 'Sub2API Quota Monitor.exe';
const recordName = 'release-record.json';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value || '')) {
    throw new Error('请用 --version 指定正式版本号，例如 0.4.2（不带 v）。');
  }
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('版本号超出有效范围。');
  return parts;
}
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
function releaseDirectory(project, version, output) {
  parseVersion(version);
  const parent = path.resolve(project, 'release');
  const target = path.resolve(project, output || `release/v${version}`);
  const relative = path.relative(parent, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('--output 必须是项目 release 目录中的子目录。');
  }
  return target;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, shell: false,
    stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8', env: options.env || process.env });
  if (result.error) throw new Error(`无法运行 ${command}：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args[0] || ''} 失败（${result.status}）。${options.capture ? `\n${result.stderr || result.stdout}` : ''}`);
  return result.stdout?.trim() || '';
}
function npm(...args) {
  const cli = process.env.npm_execpath;
  if (!cli || !fs.existsSync(cli)) throw new Error('请通过 npm run release:prepare 等命令运行此脚本。');
  run(process.execPath, [cli, ...args]);
}
function fileProof(directory, name) {
  const file = path.join(directory, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`缺少发布文件：${file}`);
  return { name, size: fs.statSync(file).size,
    sha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64') };
}
function verifyArtifacts(directory, version) {
  parseVersion(version);
  const name = `Sub2API-Quota-Monitor-Setup-${version}.exe`;
  const assets = [name, `${name}.blockmap`, 'latest.yml'].map(file => fileProof(directory, file));
  const manifest = yaml.load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
  const installer = assets[0], entry = manifest?.files?.[0];
  if (manifest?.version !== version || manifest?.path !== name || manifest?.sha512 !== installer.sha512 ||
      manifest?.files?.length !== 1 || entry?.url !== name || entry?.size !== installer.size || entry?.sha512 !== installer.sha512) {
    throw new Error('latest.yml 的版本、文件名、大小或 SHA-512 与安装包不一致。');
  }
  const appDirectory = path.join(directory, 'win-unpacked');
  if (!fs.existsSync(path.join(appDirectory, executable))) throw new Error('缺少免安装程序。');
  const packaged = JSON.parse(asar.extractFile(path.join(appDirectory, 'resources', 'app.asar'), 'package.json').toString('utf8'));
  if (packaged.version !== version) throw new Error('免安装程序的内置版本与发布版本不一致。');
  const recordPath = path.join(directory, recordName);
  const record = fs.existsSync(recordPath) ? readJson(recordPath) : null;
  if (record && (record.schema !== 1 || record.version !== version || JSON.stringify(record.assets) !== JSON.stringify(assets) ||
      record.validation?.typecheck !== true || record.validation?.unitTests !== true || record.validation?.packagedDesktop !== true)) {
    throw new Error('发布文件与构建记录不一致，或发布前检查尚未完成。');
  }
  return { assets, record };
}
function repository() {
  const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
  const github = config.publish?.find(item => item.provider === 'github');
  if (!github || !/^[\w-]+$/.test(github.owner) || !/^[\w.-]+$/.test(github.repo)) throw new Error('缺少有效的 GitHub 更新仓库配置。');
  return `${github.owner}/${github.repo}`;
}
function sourceDigest() {
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { capture: true }).split('\0').filter(Boolean).sort();
  const hash = crypto.createHash('sha256');
  for (const name of files) {
    const file = path.join(root, name);
    const content = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'deleted';
    hash.update(name).update('\0').update(content).update('\0');
  }
  return hash.digest('hex');
}
function draftArguments(version, directory, repo, commit, notes) {
  const files = [`Sub2API-Quota-Monitor-Setup-${version}.exe`, `Sub2API-Quota-Monitor-Setup-${version}.exe.blockmap`, 'latest.yml'];
  return ['release', 'create', `v${version}`, ...files.map(file => path.join(directory, file)),
    '--repo', repo, '--target', commit, '--title', `v${version}`, '--draft',
    ...(notes ? ['--notes-file', notes] : ['--generate-notes'])];
}
async function prepare(version, directory) {
  if (process.platform !== 'win32') throw new Error('Windows 发布包请在 Windows 上构建。');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('需要 Node.js 22.12 或更高版本。');
  if (fs.existsSync(directory)) throw new Error(`输出目录已存在：${directory}\n请使用新版本号，或用 --output 指定另一个 release 子目录。`);
  const current = readJson(path.join(root, 'package.json')).version;
  if (compareVersions(version, current) < 0) throw new Error(`发布版本 ${version} 不能低于当前版本 ${current}。`);
  if (current !== version) npm('version', version, '--no-git-tag-version', '--ignore-scripts');
  const lock = readJson(path.join(root, 'package-lock.json'));
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package-lock.json 的版本未同步，请先运行 npm install。');
  const repo = repository(), digest = sourceDigest();
  const stageParent = path.join(root, '.data', 'release-preparation');
  fs.mkdirSync(stageParent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(stageParent, `v${version}-`));
  console.log(`准备 v${version}，临时构建目录：${stage}`);
  npm('run', 'typecheck');
  npm('test');
  npm('run', 'icons');
  npm('run', 'build');
  run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--x64', '--publish', 'never', `-c.directories.output=${stage}`]);
  verifyArtifacts(stage, version);
  const smokeOutput = `electron-release-v${version}-${path.basename(stage).split('-').at(-1)}`;
  npmWithEnvironment({ QUOTA_EXECUTABLE: path.join(stage, 'win-unpacked', executable), QUOTA_SMOKE_OUTPUT: smokeOutput,
    QUOTA_TEST_UPDATE_VERSION: undefined, QUOTA_DATA_DIR: undefined }, 'run', 'test:desktop');
  const report = readJson(path.join(root, 'artifacts', smokeOutput, 'result.json'));
  if (report.passed !== true) throw new Error('打包版桌面验证未通过。');
  if (sourceDigest() !== digest) throw new Error('构建期间项目文件发生变化，请重新准备发布包。');
  const { assets } = verifyArtifacts(stage, version);
  fs.writeFileSync(path.join(stage, recordName), JSON.stringify({ schema: 1, version, repository: repo,
    preparedAt: new Date().toISOString(), sourceDigest: digest, assets,
    validation: { typecheck: true, unitTests: true, packagedDesktop: true, report: `artifacts/${smokeOutput}/result.json` } }, null, 2) + '\n');
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  // Both paths are created under the project; completed packages are moved without replacing earlier releases.
  if (fs.existsSync(directory)) throw new Error('发布目录在构建期间被创建，已保留临时产物，请改用其他目录。');
  // Windows can briefly retain an executable handle after the desktop test exits.
  for (let attempt = 0; ; attempt++) {
    if (fs.existsSync(directory)) throw new Error('发布目录在归档期间被创建，已保留临时产物。');
    try { fs.renameSync(stage, directory); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) throw error;
      if (attempt === 0) console.log('等待 Windows 释放构建目录后归档…');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  console.log(`\n发布包已通过检查：${directory}\n下一步：提交并推送代码，然后运行 npm run release:draft -- --version ${version}${directory === releaseDirectory(root, version) ? '' : ` --output ${path.relative(root, directory)}`}`);
}
function npmWithEnvironment(env, ...args) {
  if (!process.env.npm_execpath) throw new Error('请通过 npm run 运行此脚本。');
  const clean = { ...process.env, ...env };
  for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
  run(process.execPath, [process.env.npm_execpath, ...args], { env: clean });
}
function draft(version, directory, notes, dryRun) {
  const { record } = verifyArtifacts(directory, version), repo = repository();
  if (!record) throw new Error('此目录没有完整构建记录，请先使用 release:prepare 生成发布包。');
  if (record.repository !== repo || record.sourceDigest !== sourceDigest()) throw new Error('项目内容已不同于构建时的内容，请重新准备发布包。');
  if (notes && (!fs.existsSync(notes) || !fs.statSync(notes).isFile())) throw new Error('找不到更新说明文件。');
  const commit = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const args = draftArguments(version, directory, repo, commit, notes);
  if (dryRun) {
    console.log(JSON.stringify({ action: '创建 GitHub Release 草稿', repository: repo, tag: `v${version}`,
      command: 'gh', args, reminder: '正式执行前需要提交并推送本次代码。' }, null, 2));
    return;
  }
  if (run('git', ['status', '--porcelain'], { capture: true })) throw new Error('请先提交本次代码及版本文件，再创建 Release 草稿。');
  const remote = run('git', ['remote', 'get-url', 'origin'], { capture: true }).replace(/\.git$/, '');
  if (![ `https://github.com/${repo}`, `git@github.com:${repo}`, `ssh://git@github.com/${repo}` ].includes(remote)) throw new Error('origin 与更新仓库配置不一致。');
  run('gh', ['--version']);
  run('gh', ['auth', 'status']);
  run('git', ['fetch', 'origin', 'main']);
  if (run('git', ['rev-parse', 'origin/main'], { capture: true }) !== commit) throw new Error('当前提交尚未同步到 origin/main，请先推送或同步主分支。');
  run('gh', args);
  console.log(`\n草稿已上传：https://github.com/${repo}/releases\n在 GitHub 确认说明和三个附件，点击 Publish release 后客户端才会收到更新。`);
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    version: { type: 'string' }, output: { type: 'string' }, notes: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false } } });
  if (values.help) {
    console.log('npm run release:prepare -- --version 0.4.2\nnpm run release:verify -- --version 0.4.2\nnpm run release:draft -- --version 0.4.2 [--notes docs/release-notes.md] [--dry-run]\n可用 --output release/其他目录 指定输出。');
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || !['prepare', 'verify', 'draft'].includes(command)) throw new Error('请选择 prepare、verify 或 draft。');
  if (command !== 'draft' && (values.notes || values['dry-run'])) throw new Error('--notes 和 --dry-run 只用于 draft。');
  parseVersion(values.version);
  const directory = releaseDirectory(root, values.version, values.output);
  if (command === 'prepare') await prepare(values.version, directory);
  else if (command === 'draft') draft(values.version, directory, values.notes ? path.resolve(root, values.notes) : undefined, values['dry-run']);
  else { const { record } = verifyArtifacts(directory, values.version); console.log(`发布文件校验通过：${directory}${record ? '（含完整构建记录）' : '（历史产物，未包含新脚本的构建记录）'}`); }
}

module.exports = { parseVersion, compareVersions, releaseDirectory, verifyArtifacts, draftArguments };
if (require.main === module) main().catch(error => { console.error(`\n发布流程停止：${error.message}`); process.exitCode = 1; });
