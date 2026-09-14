#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(desktopRoot, '..', '..')
const platform = process.argv[2]
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const flutter =
  process.env.FLUTTER_BIN || (process.platform === 'win32' ? 'flutter.bat' : 'flutter')
const pubspec = readFileSync(join(desktopRoot, 'pubspec.yaml'), 'utf8')
const version = process.env.RELEASE_VERSION || /^version:\s*([^+\s]+)/m.exec(pubspec)?.[1]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be X.Y.Z')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    env: { ...process.env, ...options.env }
  })
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`)
}

if (!['macos', 'windows'].includes(platform)) {
  throw new Error('Usage: node build-desktop.mjs <macos|windows>')
}
if (platform === 'macos' && process.platform !== 'darwin') throw new Error('Build macOS on macOS')
if (platform === 'macos' && !['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`)
}
if (platform === 'windows' && process.platform !== 'win32')
  throw new Error('Build Windows on Windows')

run(npm, ['run', 'build', '-w', 'eve'], {
  env: { HELIOS_AI_BASE_URL: 'http://127.0.0.1', HELIOS_AI_KEY: 'build' }
})
run(npm, ['run', 'build', '-w', '@helios/desktop-backend'])
run(flutter, ['build', platform, '--release', `--build-name=${version}`], { cwd: desktopRoot })

const dist = join(desktopRoot, 'dist')
mkdirSync(dist, { recursive: true })
if (platform === 'macos') {
  const macArchitecture = process.arch
  const app = join(desktopRoot, 'build', 'macos', 'Build', 'Products', 'Release', 'Sealos.app')
  const runtime = join(app, 'Contents', 'Resources', 'helios')
  run(process.execPath, [
    join(desktopRoot, 'scripts', 'prepare-runtime.mjs'),
    `macos-${macArchitecture}`,
    runtime
  ])
  run('codesign', ['--force', '--deep', '--sign', '-', app])
  const dmg = join(dist, `Helios-${version}-mac-${macArchitecture}.dmg`)
  rmSync(dmg, { force: true })
  run('hdiutil', ['create', '-volname', 'Sealos', '-srcfolder', app, '-ov', '-format', 'UDZO', dmg])
} else {
  const build = join(desktopRoot, 'build', 'windows', 'x64', 'runner', 'Release')
  run(process.execPath, [
    join(desktopRoot, 'scripts', 'prepare-runtime.mjs'),
    'windows-x64',
    join(build, 'helios')
  ])
  const iscc = process.env.ISCC_PATH || 'ISCC.exe'
  if (!existsSync(join(desktopRoot, 'windows', 'installer.iss')))
    throw new Error('Missing installer.iss')
  run(iscc, [join(desktopRoot, 'windows', 'installer.iss')], {
    env: { HELIOS_VERSION: version, HELIOS_WINDOWS_BUILD_DIR: build, HELIOS_DIST_DIR: dist }
  })
}
