/**
 * @file tests/electronPreload.test.ts
 * @description The Electron window runs with `sandbox: true`, where preload scripts cannot use
 * ESM `import`. Compiles the preload with `tsconfig.preload.json` and checks the result is a
 * CommonJS `preload.cjs` that `electron/main.ts` actually loads.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

describe('Electron preload build', () => {
  it('compiles to a CommonJS preload.cjs that main.ts loads', () => {
    const configPath = join(root, 'tsconfig.preload.json');
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    const outDir = mkdtempSync(join(tmpdir(), 'ic980-preload-'));
    try {
      const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
      const program = ts.createProgram(parsed.fileNames, { ...parsed.options, outDir });
      const result = program.emit();
      const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);

      const output = readFileSync(join(outDir, 'preload.cjs'), 'utf-8');
      expect(output).toContain('require("electron")');
      expect(output).not.toMatch(/^\s*(import|export)\s/m);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }

    const mainSource = readFileSync(join(root, 'electron', 'main.ts'), 'utf-8');
    expect(mainSource).toContain("path.join(__dirname, 'preload.cjs')");
    expect(mainSource).toMatch(/sandbox:\s*true/);
  });
});

describe('Electron preload bridge', () => {
  it('exposes exactly the methods the renderer uses', () => {
    const source = readFileSync(join(root, 'electron', 'preload.cts'), 'utf-8');
    const block = /exposeInMainWorld\('api', \{([\s\S]*?)\n\}\);/.exec(source)?.[1] ?? '';
    const keys = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'platform',
      'fetchRepeaterBookJson',
      'listRollbackSnapshots',
      'saveRollbackSnapshot',
      'deleteRollbackSnapshot',
    ]);
  });
});
