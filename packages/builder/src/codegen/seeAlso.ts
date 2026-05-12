/**
 * Hand-curated "See also" link table — maps registry tags to related
 * documentation pages. Keys must match actual registry tag names; missing
 * keys cause the page to skip the "See also" section. Validated by
 * seeAlso.test.ts. External GitHub URLs cannot be 404-checked offline
 * (see design §4.3).
 */

export interface SeeAlsoEntry {
  readonly label: string;
  readonly href: string;
}

export const SEE_ALSO: Readonly<Record<string, ReadonlyArray<SeeAlsoEntry>>> = {};
