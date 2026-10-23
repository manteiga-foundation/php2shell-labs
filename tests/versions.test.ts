// The advisory data, encoded. RED first: fail until engine/versions.ts exists.

import { classifyPhpVersion, extractPhpVersion, parsePhpVersion } from '../engine/versions';
import { describe, expect, test } from 'bun:test';

describe('parsePhpVersion', () => {
  test('parses the X-Powered-By form', () => {
    expect(parsePhpVersion('PHP/7.1.26')).toEqual({ major: 7, minor: 1, patch: 26 });
  });

  test('parses two-segment versions with patch 0', () => {
    expect(parsePhpVersion('PHP/8.2')).toEqual({ major: 8, minor: 2, patch: 0 });
  });

  test('parses inside a Server header value', () => {
    expect(parsePhpVersion('Apache/2.2.8 (Win32) PHP/5.2.6')).toEqual({ major: 5, minor: 2, patch: 6 });
  });

  test('ignores non-PHP strings', () => {
    expect(parsePhpVersion('Apache/2.4.25 (Debian)')).toBeNull();
    expect(parsePhpVersion('')).toBeNull();
    expect(parsePhpVersion('ASP.NET')).toBeNull();
  });
});

describe('extractPhpVersion', () => {
  test('reads X-Powered-By first', () => {
    expect(
      extractPhpVersion({ server: 'Apache/2.4.25 (Debian)', poweredBy: 'PHP/7.1.26' }),
    ).toEqual({ major: 7, minor: 1, patch: 26 });
  });

  test('falls back to the Server header suffix', () => {
    expect(extractPhpVersion({ server: 'Apache/2.2.8 (Win32) PHP/5.2.6', poweredBy: undefined })).toEqual({
      major: 5,
      minor: 2,
      patch: 6,
    });
  });

  test('null when neither header mentions PHP', () => {
    expect(extractPhpVersion({ server: 'nginx/1.24.0', poweredBy: 'Express' })).toBeNull();
    expect(extractPhpVersion({})).toBeNull();
  });
});

describe('classifyPhpVersion', () => {
  test('the four fixed releases are patched', () => {
    expect(classifyPhpVersion({ major: 8, minor: 5, patch: 12 })).toBe('patched');
    expect(classifyPhpVersion({ major: 8, minor: 4, patch: 27 })).toBe('patched');
    expect(classifyPhpVersion({ major: 8, minor: 3, patch: 36 })).toBe('patched');
    expect(classifyPhpVersion({ major: 8, minor: 2, patch: 35 })).toBe('patched');
  });

  test('anything newer than the fixed releases is treated as patched', () => {
    expect(classifyPhpVersion({ major: 8, minor: 6, patch: 0 })).toBe('patched');
    expect(classifyPhpVersion({ major: 9, minor: 0, patch: 0 })).toBe('patched');
    expect(classifyPhpVersion({ major: 8, minor: 5, patch: 13 })).toBe('patched');
  });

  test('the last vulnerable builds of the supported branches', () => {
    expect(classifyPhpVersion({ major: 8, minor: 5, patch: 11 })).toBe('vulnerable');
    expect(classifyPhpVersion({ major: 8, minor: 4, patch: 26 })).toBe('vulnerable');
    expect(classifyPhpVersion({ major: 8, minor: 3, patch: 35 })).toBe('vulnerable');
    expect(classifyPhpVersion({ major: 8, minor: 2, patch: 34 })).toBe('vulnerable');
  });

  test('supported-branch builds below the fix are vulnerable (a patch exists)', () => {
    expect(classifyPhpVersion({ major: 8, minor: 2, patch: 0 })).toBe('vulnerable');
    expect(classifyPhpVersion({ major: 8, minor: 4, patch: 10 })).toBe('vulnerable');
  });

  test('end-of-life branches inside the range get no patch', () => {
    expect(classifyPhpVersion({ major: 8, minor: 1, patch: 30 })).toBe('no-patch');
    expect(classifyPhpVersion({ major: 8, minor: 0, patch: 30 })).toBe('no-patch');
    expect(classifyPhpVersion({ major: 7, minor: 4, patch: 33 })).toBe('no-patch');
    expect(classifyPhpVersion({ major: 7, minor: 1, patch: 26 })).toBe('no-patch');
    expect(classifyPhpVersion({ major: 5, minor: 6, patch: 40 })).toBe('no-patch');
    expect(classifyPhpVersion({ major: 5, minor: 4, patch: 0 })).toBe('no-patch');
  });

  test('below 5.4.0 the vulnerable code does not exist', () => {
    expect(classifyPhpVersion({ major: 5, minor: 3, patch: 29 })).toBe('below-range');
    expect(classifyPhpVersion({ major: 5, minor: 2, patch: 6 })).toBe('below-range');
    expect(classifyPhpVersion({ major: 4, minor: 4, patch: 9 })).toBe('below-range');
  });

  test('segment comparison is numeric, not textual', () => {
    // 8.10 must sort above 8.9: guard against string comparison bugs.
    expect(classifyPhpVersion({ major: 8, minor: 10, patch: 0 })).toBe('patched');
    expect(parsePhpVersion('PHP/8.10.1')).toEqual({ major: 8, minor: 10, patch: 1 });
  });
});
