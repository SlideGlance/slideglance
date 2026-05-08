import { describe, it, expect } from "vitest";
import { buildPptxInterceptRule, PPTX_RULE_ID } from "./intercept-rule.js";

describe("buildPptxInterceptRule", () => {
  it("redirects to viewer.html#<originalUrl> via fragment substitution", () => {
    const viewer = "chrome-extension://abc/src/viewer/index.html";
    const rule = buildPptxInterceptRule(viewer);
    expect(rule.id).toBe(PPTX_RULE_ID);
    expect(rule.action.type).toBe("redirect");
    // \0 is the entire matched URL. Fragment instead of ?src= so
    // the substituted URL's own `?token=a&user=b` survives without
    // URLSearchParams splitting on the `&`.
    expect(rule.action.redirect?.regexSubstitution).toBe(`${viewer}#\\0`);
    expect(rule.condition.regexFilter).toBe("^https?://.*\\.pptx(\\?.*)?$");
    expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
  });

  it("does not use ?src= query (fragment-only)", () => {
    const viewer = "chrome-extension://abc/src/viewer/index.html";
    const rule = buildPptxInterceptRule(viewer);
    expect(rule.action.redirect?.regexSubstitution).not.toContain("?src=");
  });

  it("does not produce $-style backreferences (only \\0 is used)", () => {
    const viewer = "chrome-extension://abc/src/viewer/index.html";
    const rule = buildPptxInterceptRule(viewer);
    expect(rule.action.redirect?.regexSubstitution).not.toMatch(/\$\d/);
  });

  it("uses a stable rule id so updateDynamicRules can replace cleanly", () => {
    const a = buildPptxInterceptRule("chrome-extension://a/v.html");
    const b = buildPptxInterceptRule("chrome-extension://b/v.html");
    expect(a.id).toBe(b.id);
  });
});
