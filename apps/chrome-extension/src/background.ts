import {
  buildPptxInterceptRule,
  PPTX_RULE_ID,
} from "./shared/intercept-rule.js";

const VIEWER_PATH = "src/viewer/index.html";
const CONTEXT_MENU_ID = "slideglance-open-link";

function viewerUrl(src?: string): string {
  const base = chrome.runtime.getURL(VIEWER_PATH);
  // Use fragment, not ?src=, to match the DNR path (see
  // intercept-rule.ts) and to preserve multi-param URLs verbatim.
  return src ? `${base}#${src}` : base;
}

async function registerInterceptRule(): Promise<void> {
  const rule = buildPptxInterceptRule(chrome.runtime.getURL(VIEWER_PATH));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PPTX_RULE_ID],
    addRules: [rule],
  });
}

function registerContextMenu(): void {
  // removeAll → create idempotent on every install/startup.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Open with SlideGlance",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pptx*"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void registerInterceptRule();
  registerContextMenu();
});

// Service workers may suspend; re-register on browser startup.
chrome.runtime.onStartup?.addListener(() => {
  void registerInterceptRule();
  registerContextMenu();
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: viewerUrl() });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!info.linkUrl) return;
  void chrome.tabs.create({ url: viewerUrl(info.linkUrl) });
});
