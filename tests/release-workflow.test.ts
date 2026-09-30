import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const { parseVersion, compareVersions, releaseDirectory, verifyArtifacts, draftArguments } = require('../scripts/release.cjs');

describe('release workflow guards', () => {
  it('accepts stable numeric versions and compares them numerically', () => {
    expect(parseVersion('0.4.2')).toEqual([0, 4, 2]);
    expect(compareVersions('0.4.10', '0.4.2')).toBe(1);
    expect(compareVersions('0.4.1', '0.4.2')).toBe(-1);
    for (const version of ['v0.4.2', '0.4.2-beta.1', '00.4.2', '0.4', '', '0.4.2/../src']) {
      expect(() => parseVersion(version)).toThrow();
    }
  });

  it('keeps build destinations under the project release directory', () => {
    const project = path.join(os.tmpdir(), 'quota-release-path');
    expect(releaseDirectory(project, '0.4.2')).toBe(path.join(project, 'release', 'v0.4.2'));
    expect(releaseDirectory(project, '0.4.2', 'release/custom output')).toBe(path.join(project, 'release', 'custom output'));
    for (const output of ['release', '.', '../elsewhere', 'release/../src']) {
      expect(() => releaseDirectory(project, '0.4.2', output)).toThrow();
    }
  });

  it('uploads exactly the updater assets to a draft tied to a commit', () => {
    const directory = path.join(os.tmpdir(), 'quota-release');
    const args = draftArguments('0.4.2', directory, 'bunnya33/sub2api_monitor', 'abc123');
    expect(args.slice(0, 6)).toEqual(['release', 'create', 'v0.4.2',
      path.join(directory, 'Sub2API-Quota-Monitor-Setup-0.4.2.exe'),
      path.join(directory, 'Sub2API-Quota-Monitor-Setup-0.4.2.exe.blockmap'), path.join(directory, 'latest.yml')]);
    expect(args).toContain('--draft');
    expect(args.slice(args.indexOf('--target'), args.indexOf('--target') + 2)).toEqual(['--target', 'abc123']);
    expect(args).toContain('--generate-notes');
    const custom = draftArguments('0.4.2', directory, 'bunnya33/sub2api_monitor', 'abc123', 'notes.md');
    expect(custom).toContain('--notes-file');
    expect(custom).not.toContain('--generate-notes');
  });
});

describe('release artifact integrity', () => {
  let directory: string;
  const version = '0.4.2', name = `Sub2API-Quota-Monitor-Setup-${version}.exe`;
  let manifest: { version: string; path: string; sha512: string; files: { url: string; size: number; sha512: string }[] };
  const writeManifest = () => fs.writeFileSync(path.join(directory, 'latest.yml'), yaml.dump(manifest));
  const packageVersion = async (value: string) => {
    const source = path.join(directory, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: value }));
    await asar.createPackage(source, path.join(directory, 'win-unpacked', 'resources', 'app.asar'));
    asar.uncacheAll();
  };
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-release-test-'));
    const contents = Buffer.from('test installer');
    fs.writeFileSync(path.join(directory, name), contents);
    fs.writeFileSync(path.join(directory, `${name}.blockmap`), 'test blockmap');
    fs.mkdirSync(path.join(directory, 'win-unpacked', 'resources'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'win-unpacked', 'Sub2API Quota Monitor.exe'), 'test executable');
    const sha512 = crypto.createHash('sha512').update(contents).digest('base64');
    manifest = { version, path: name, sha512, files: [{ url: name, size: contents.length, sha512 }] };
    writeManifest();
    await packageVersion(version);
  });
  afterEach(() => {
    asar.uncacheAll();
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('quota-release-test-')) throw new Error('Unexpected temporary path');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it('validates a matching installer, manifest and embedded application version', () => {
    expect(verifyArtifacts(directory, version).assets.map((asset: { name: string }) => asset.name)).toEqual([name, `${name}.blockmap`, 'latest.yml']);
  });
  it('rejects an installer modified after its manifest was generated', () => {
    fs.appendFileSync(path.join(directory, name), 'changed');
    expect(() => verifyArtifacts(directory, version)).toThrow('SHA-512');
  });
  it('rejects a manifest with a different version or attachment name', () => {
    manifest.version = '0.4.3'; writeManifest();
    expect(() => verifyArtifacts(directory, version)).toThrow('latest.yml');
    manifest.version = version; manifest.files[0].url = 'renamed.exe'; writeManifest();
    expect(() => verifyArtifacts(directory, version)).toThrow('latest.yml');
  });
  it('rejects a missing blockmap and an embedded version from another build', async () => {
    await packageVersion('0.4.3');
    expect(() => verifyArtifacts(directory, version)).toThrow('内置版本');
    fs.unlinkSync(path.join(directory, `${name}.blockmap`));
    expect(() => verifyArtifacts(directory, version)).toThrow('缺少发布文件');
  });
  it('rejects assets changed after a completed build record', () => {
    const { assets } = verifyArtifacts(directory, version);
    fs.writeFileSync(path.join(directory, 'release-record.json'), JSON.stringify({ schema: 1, version, assets,
      validation: { typecheck: true, unitTests: true, packagedDesktop: true } }));
    expect(verifyArtifacts(directory, version).record.version).toBe(version);
    fs.appendFileSync(path.join(directory, `${name}.blockmap`), 'changed');
    expect(() => verifyArtifacts(directory, version)).toThrow('构建记录');
  });
});
