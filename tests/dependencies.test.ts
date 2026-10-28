/**
 * @file tests/dependencies.test.ts
 * @description Guards `npm ci` against peer-dependency conflicts by checking every required
 * peer dependency recorded in `package-lock.json` against the version actually locked.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LockPackage {
  version?: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const parseVersion = (v: string): [number, number, number] => {
  const [major = 0, minor = 0, patch = 0] = v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  return [major, minor, patch];
};

const compare = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Minimal semver range check covering the operators used in this lockfile (`^`, `>=`, `*`, `||`). */
function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  return range.split('||').some((set) => {
    const comparators = set.trim().replace(/(>=|<=|>|<)\s+/g, '$1').split(/\s+/).filter(Boolean);
    return comparators.every((c) => {
      if (c === '*' || c === 'x') return true;
      if (c.startsWith('^')) {
        const min = parseVersion(c.slice(1));
        if (compare(v, min) < 0) return false;
        return min[0] > 0 ? v[0] === min[0] : v[0] === 0 && v[1] === min[1];
      }
      if (c.startsWith('>=')) return compare(v, parseVersion(c.slice(2))) >= 0;
      if (c.startsWith('>')) return compare(v, parseVersion(c.slice(1))) > 0;
      if (c.startsWith('<=')) return compare(v, parseVersion(c.slice(2))) <= 0;
      if (c.startsWith('<')) return compare(v, parseVersion(c.slice(1))) < 0;
      return compare(v, parseVersion(c)) === 0;
    });
  });
}

describe('package-lock.json peer dependencies', () => {
  it('evaluates the range operators used by the lockfile', () => {
    expect(satisfies('8.3.5', '^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0')).toBe(false);
    expect(satisfies('8.3.5', '^6.0.0 || ^7.0.0 || ^8.0.0')).toBe(true);
    expect(satisfies('7.26.0', '^7.0.0-0')).toBe(true);
    expect(satisfies('4.24.4', '>= 4.21.0')).toBe(true);
  });

  it('satisfies every required peer dependency so `npm ci` succeeds without --legacy-peer-deps', () => {
    const lock = JSON.parse(readFileSync(resolve(__dirname, '..', 'package-lock.json'), 'utf-8')) as {
      packages: Record<string, LockPackage>;
    };
    // Resolve a peer the way Node does: nearest enclosing node_modules first, then upward.
    const installed = (fromKey: string, name: string): string | undefined => {
      let dir = fromKey.slice(0, fromKey.lastIndexOf('node_modules/'));
      for (;;) {
        const hit = lock.packages[`${dir}node_modules/${name}`];
        if (hit?.version) return hit.version;
        if (!dir) return undefined;
        dir = dir.slice(0, dir.slice(0, -1).lastIndexOf('node_modules/'));
      }
    };

    const conflicts: string[] = [];
    for (const [key, pkg] of Object.entries(lock.packages)) {
      if (!key || !pkg.peerDependencies) continue;
      for (const [peer, range] of Object.entries(pkg.peerDependencies)) {
        const version = installed(key, peer);
        const optional = pkg.peerDependenciesMeta?.[peer]?.optional === true;
        if (!version) {
          if (!optional) conflicts.push(`${key} requires missing peer ${peer}@${range}`);
          continue;
        }
        if (!satisfies(version, range)) {
          conflicts.push(`${key} requires ${peer}@${range} but ${version} is locked`);
        }
      }
    }

    expect(conflicts).toEqual([]);
  });
});
