import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as antd from 'ant-design-vue';
import { expect, it } from 'vitest';

// A PascalCase tag that is not imported falls back to a plain HTML element, so
// `<Input v-model:value>` would silently stop updating its model. vue-tsc and
// eslint accept that template, so this test checks the imports directly.
const root = 'apps/web-antd/src';
const components = new Set(Object.keys(antd).filter((name) => /^[A-Z]/.test(name)));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.vue') ? [path] : [];
  });
}

it('imports every Ant Design component used in a template', () => {
  const missing: string[] = [];
  for (const path of files(root)) {
    const source = readFileSync(path, 'utf8');
    const template = source.slice(source.indexOf('<template'));
    const used = new Set([...template.matchAll(/<([A-Z][A-Za-z]+)[\s/>]/g)].map((match) => match[1]!));
    const imported = new Set(
      [...source.matchAll(/import \{([^}]*)\} from 'ant-design-vue'/g)]
        .flatMap((match) => match[1]!.split(','))
        .map((name) => name.trim()),
    );
    // A local binding with the same name, such as the Grid returned by useVbenVxeGrid, is not an antd tag.
    const local = (name: string) => new RegExp(String.raw`(?:const|let|import)[^\n;]*\b${name}\b`).test(source);
    for (const name of used) {
      if (components.has(name) && !imported.has(name) && !local(name)) missing.push(`${path}: ${name}`);
    }
  }
  expect(missing).toEqual([]);
});
