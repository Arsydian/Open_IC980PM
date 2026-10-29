/**
 * @file tests/docs.test.ts
 * @description Keeps README.md, LICENSE and package.json consistent with each other and the repo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf-8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  license: string;
  repository: { url: string };
};

describe('project documentation', () => {
  it('ships the MIT LICENSE that README and package.json refer to', () => {
    expect(pkg.license).toBe('MIT');
    expect(readFileSync(join(root, 'LICENSE'), 'utf-8')).toMatch(/^MIT License/);
  });

  it('points every relative README link at a file that exists', () => {
    const relative = [...readme.matchAll(/\]\(([^)#\s]+)\)/g)]
      .map((m) => m[1])
      .filter((target) => !/^[a-z]+:/i.test(target));
    expect(relative.length).toBeGreaterThan(0);
    expect(relative.filter((target) => !existsSync(join(root, target)))).toEqual([]);
  });

  it('clones from the repository named in package.json', () => {
    expect(readme).toContain(`git clone ${pkg.repository.url}`);
  });

  it('does not promise mobile features the app does not have', () => {
    expect(readme).not.toMatch(/Add to Home screen|npx cap add|GPS-based/);
    expect(existsSync(join(root, 'public', 'manifest.webmanifest'))).toBe(false); // update both if a PWA is added
  });
});
