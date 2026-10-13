// `node native/hook-helper/run.mjs build|test`: builds the hook helper (and runs its C++ tests) on Windows or macOS.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: here });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const action = process.argv[2];
if (action !== 'build' && action !== 'test') {
  console.error('usage: node native/hook-helper/run.mjs build|test');
  process.exit(2);
}
// The explicit .\ matters: cmd may be set to not search the current directory for commands.
const zig = process.env.PINGSCREEN_ZIG || join(here, '../../.tools/zig-x86_64-windows-0.14.1/zig.exe');
if (win && existsSync(zig)) {
  mkdirSync(join(here, 'build'), { recursive: true });
  const flags = ['c++', '-target', 'x86_64-windows-gnu', '-std=c++20', '-O2', '-DUNICODE', '-D_UNICODE'];
  run(zig, [...flags, '-municode', 'src/main_win.cpp', 'src/hooks_win.cpp', 'src/simulate.cpp', 'src/commands.cpp', 'src/output.cpp', 'src/json.cpp', 'src/decision.cpp', '-luser32', '-o', 'build/hook-helper.exe']);
  run(zig, [...flags, 'tests/helper_tests.cpp', 'src/decision.cpp', 'src/commands.cpp', 'src/macinput.cpp', 'src/json.cpp', 'src/output.cpp', '-o', 'build/helper_tests.exe']);
  run(zig, [...flags, 'src/capture_win.cpp', '-ld3d11', '-ldxgi', '-ldwmapi', '-lgdi32', '-luser32', '-lole32', '-lwindowscodecs', '-luuid', '-o', 'build/capture-helper.exe']);
  run(zig, [...flags, 'tests/color_tests.cpp', '-o', 'build/color_tests.exe']);
} else if (win) run('cmd.exe', ['/d', '/c', '.\\build.cmd']);
else run('sh', ['build.sh']);
if (action === 'test') run(join(here, 'build', win ? 'helper_tests.exe' : 'helper_tests'), []);
if (action === 'test' && win) run(join(here, 'build', 'color_tests.exe'), []);
