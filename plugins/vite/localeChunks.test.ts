// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { build } from 'vite';
import { expect, it } from 'vitest';

import { createSharedRolldownOutput } from './sharedRendererConfig';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

it('loads antd and dayjs locales from production chunks without an initialization cycle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lobe-locale-chunks-'));
  const entry = path.join(root, 'entry.js');
  const sourcePath = (id: string) => JSON.stringify(require.resolve(id).replaceAll('\\', '/'));

  try {
    await writeFile(
      entry,
      `import dayjs from ${sourcePath('dayjs')};
import enUS from ${sourcePath('antd/es/locale/en_US.js')};
export const initial = enUS.locale;
export const loadPicker = () => import(${sourcePath('antd/es/date-picker/locale/zh_CN.js')});
export async function load() {
  const [date, antd] = await Promise.all([
    import(${sourcePath('dayjs/locale/zh-cn.js')}),
    import(${sourcePath('antd/es/locale/zh_CN.js')})
  ]);
  dayjs.locale(date.default);
  return [antd.default.locale, antd.default.DatePicker.lang.placeholder, dayjs.locale()];
}`,
    );
    await build({
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      root,
      build: {
        modulePreload: false,
        outDir: path.join(root, 'dist'),
        rolldownOptions: {
          input: entry,
          output: { ...createSharedRolldownOutput(), entryFileNames: 'entry.mjs' },
          preserveEntrySignatures: 'allow-extension',
        },
      },
    });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "globalThis.window = new EventTarget(); import('./dist/entry.mjs').then(async m => console.log(JSON.stringify(await m.load())))",
      ],
      { cwd: root },
    );
    expect(JSON.parse(stdout.trim())).toEqual(['zh-cn', '请选择日期', 'zh-cn']);
  } finally {
    // The directory is the unique temporary fixture created by this test.
    await rm(root, { force: true, recursive: true });
  }
}, 30_000);
