// Stable id for the dynamic DNR rule. Reused on every register so
// updateDynamicRules({ removeRuleIds: [PPTX_RULE_ID], addRules: [...] })
// idempotently replaces the rule.
export const PPTX_RULE_ID = 1;

// Pure factory for the declarativeNetRequest rule that redirects any
// navigation to a `.pptx` URL to the in-extension viewer page.
//
// The viewer URL must come from `chrome.runtime.getURL()` at runtime —
// it cannot be embedded in a static rule resource because the
// extension ID isn't known at build time.
//
// The substituted URL is appended as a fragment (`#`) rather than a
// query parameter (`?src=`). DNR pastes the matched URL raw into the
// substitution — if that URL contains its own query (e.g.
// `?token=a&user=b` for a presigned link), a `?src=` scheme would
// let URLSearchParams split on the embedded `&` and silently drop
// trailing pairs. Fragments are not parsed as query strings, so the
// entire substituted URL survives intact.
export function buildPptxInterceptRule(
  viewerUrl: string,
): chrome.declarativeNetRequest.Rule {
  return {
    id: PPTX_RULE_ID,
    priority: 1,
    action: {
      type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
      redirect: { regexSubstitution: `${viewerUrl}#\\0` },
    },
    condition: {
      regexFilter: "^https?://.*\\.pptx(\\?.*)?$",
      resourceTypes: [
        "main_frame" as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  };
}
