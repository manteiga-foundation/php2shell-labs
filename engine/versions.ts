// The advisory data, encoded once. Affected range: PHP 5.4.0 through 8.5.11 (CVE-2026-109618,
// CVE-2026-109619, disclosed 2026-10-21). Fixed releases: 8.5.12, 8.4.27, 8.3.36, 8.2.35.
// Branches 8.1 and older are end-of-life: vulnerable with no official fix.

export type PhpVersion = { major: number; minor: number; patch: number };

/** First patched build per supported branch. */
export const FIXED_RELEASES: Record<string, PhpVersion> = {
  '8.5': { major: 8, minor: 5, patch: 12 },
  '8.4': { major: 8, minor: 4, patch: 27 },
  '8.3': { major: 8, minor: 3, patch: 36 },
  '8.2': { major: 8, minor: 2, patch: 35 },
};

/** The vulnerable range, inclusive. */
export const AFFECTED_FROM: PhpVersion = { major: 5, minor: 4, patch: 0 };
export const AFFECTED_TO: PhpVersion = { major: 8, minor: 5, patch: 11 };

/** Highest end-of-life branch inside the range (8.1 and below have no patch). */
export const EOL_CEILING: PhpVersion = { major: 8, minor: 1, patch: Infinity };

export type VersionClass = 'patched' | 'vulnerable' | 'no-patch' | 'below-range';

function compare(a: PhpVersion, b: PhpVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Parse a PHP version out of header text ("PHP/7.1.26", "Apache/2.2.8 (Win32) PHP/5.2.6"). */
export function parsePhpVersion(text: string): PhpVersion | null {
  const m = /PHP\/(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? 0 : Number(m[3]) };
}

/** Read the version from a response's Server / X-Powered-By headers, X-Powered-By first. */
export function extractPhpVersion(headers: {
  server?: string;
  poweredBy?: string;
}): PhpVersion | null {
  if (headers.poweredBy) {
    const v = parsePhpVersion(headers.poweredBy);
    if (v) return v;
  }
  if (headers.server) {
    const v = parsePhpVersion(headers.server);
    if (v) return v;
  }
  return null;
}

export function classifyPhpVersion(v: PhpVersion): VersionClass {
  if (compare(v, AFFECTED_FROM) < 0) return 'below-range';
  if (compare(v, AFFECTED_TO) > 0) return 'patched';

  // Inside the affected range.
  const fixed = FIXED_RELEASES[`${v.major}.${v.minor}`];
  if (fixed && compare(v, fixed) >= 0) return 'patched'; // e.g. 8.5.12 within range numerically
  if (compare(v, EOL_CEILING) <= 0) return 'no-patch'; // 5.4 through 8.1: EOL, nothing to install
  return 'vulnerable'; // 8.2 through 8.5 below the fix: a patch exists
}
