// Read the source URL passed to the viewer page via the URL fragment
// (`viewer.html#<rawUrl>`) rather than via `?src=<encodedUrl>`.
//
// The fragment scheme is required because the DNR redirect rule uses
// raw `\0` substitution — it pastes the matched URL into the
// regexSubstitution without URL-encoding. If the matched URL itself
// contains `&` (e.g. a presigned link with `?token=abc&user=bob`),
// using a query parameter would let URLSearchParams split on the `&`
// and silently drop trailing pairs. Fragments are not parsed as
// query strings, so the entire substituted URL survives intact.
//
// Returns the raw fragment only when it parses as an http(s) URL.
// Any other scheme (javascript:, data:, chrome-extension:, file:)
// is rejected to keep the viewer page from being weaponized as a
// redirect for arbitrary URIs the page author didn't intend.
export function parseViewerSrc(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!url.hash || url.hash.length <= 1) return null;
  // hash includes the leading '#'; slice it off, but DON'T decode
  // because the DNR substitution writes the URL raw (already
  // contains its own `%`-encoded sequences where applicable).
  const remote = url.hash.slice(1);
  if (!/^https?:\/\//i.test(remote)) return null;
  return remote;
}
