import { describe, it, expect } from "vitest";
import { parseViewerSrc } from "./url-params.js";

// The viewer page receives the source URL via the URL fragment
// (`#<rawUrl>`) rather than `?src=<encodedUrl>` so DNR's raw
// regex-substitution preserves multi-param URLs like Drive /
// OneDrive / S3-presigned links.
describe("parseViewerSrc", () => {
  it("returns null when fragment is absent", () => {
    expect(parseViewerSrc("https://x/viewer.html")).toBeNull();
  });

  it("returns the fragment URL verbatim for single-param input", () => {
    expect(
      parseViewerSrc("https://x/viewer.html#https://example.com/foo.pptx"),
    ).toBe("https://example.com/foo.pptx");
  });

  it("preserves multi-param URLs (the DNR raw-substitution case)", () => {
    // This is the case advisor caught: a Drive / S3-presigned link
    // contains `?token=abc&user=bob` and the previous ?src= scheme
    // would lose the `&user=bob` half.
    const remote =
      "https://example.com/foo.pptx?token=abc&user=bob&signature=xyz";
    expect(parseViewerSrc(`https://x/viewer.html#${remote}`)).toBe(remote);
  });

  it("preserves URLs containing # in their query (rare but possible)", () => {
    // Fragment is everything after the FIRST #, including any
    // subsequent #. URL fragments don't have nested fragments, so
    // hash.slice(1) returns the rest correctly.
    const remote = "https://example.com/foo.pptx?title=a%23b";
    expect(parseViewerSrc(`https://x/viewer.html#${remote}`)).toBe(remote);
  });

  it("returns null when fragment is empty", () => {
    expect(parseViewerSrc("https://x/viewer.html#")).toBeNull();
  });

  it("rejects javascript: src to avoid XSS smuggling", () => {
    expect(
      parseViewerSrc("https://x/viewer.html#javascript:alert(1)"),
    ).toBeNull();
  });

  it("rejects chrome-extension: src", () => {
    expect(
      parseViewerSrc("https://x/viewer.html#chrome-extension://abc/sneaky"),
    ).toBeNull();
  });

  it("rejects file: src", () => {
    expect(
      parseViewerSrc("https://x/viewer.html#file:///etc/passwd"),
    ).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseViewerSrc("not a url")).toBeNull();
  });
});
