/**
 * HTML reference page generator. Returns a Map of relative path →
 * HTML string consumed by scripts/codegen.ts. See design §5 for page
 * structure and §6 for styling decisions.
 */

import type {
  CompiledNodeDefinition,
  ChildrenSpec,
} from "../registry/defineNode.ts";
import type { CompiledMetaDefinition } from "../registry/defineMeta.ts";
import { type ReferenceModel } from "./walkRegistry.ts";
import {
  escapeHtml,
  highlightXml,
  attrTable,
  childrenTable,
  usedByList,
} from "./htmlTemplates.ts";

const REPO_BLOB =
  "https://github.com/SlideGlance/slideglance/blob/main/packages/builder";

const FOUC_SCRIPT = `<script>(()=>{const s=localStorage.getItem("sg-theme");if(s==="light"||s==="dark")document.documentElement.setAttribute("data-theme",s)})()</script>`;

export function renderElementPage(
  node: CompiledNodeDefinition | CompiledMetaDefinition,
  model: ReferenceModel,
): string {
  const tag = node.tag;
  const example = node.example ? highlightXml(node.example) : "";
  const usedBy = model.usedBy.get(tag) ?? [];
  const seeAlso = model.seeAlso.get(tag) ?? [];
  const loc = model.sourceLocations.get(tag);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>&lt;${tag}&gt; · Builder XML Reference</title>
<link rel="stylesheet" href="../styles.css" />
${FOUC_SCRIPT}
</head>
<body class="ref-page">
<a href="#main" class="skip-link">Skip to content</a>
${renderHeader()}
<div class="ref-shell">
${renderSidebar(tag, model)}
<main id="main" class="ref-content">
<h1><code>&lt;${tag}&gt;</code></h1>
<p class="ref-lede">${escapeHtml(node.description ?? "")}</p>
<h2>Attributes</h2>
${attrTable(node.attributes ?? {})}
<h2>Allowed children</h2>
${childrenTable(getChildrenSpec(node))}
<h2>Used by</h2>
${usedByList(usedBy)}
${node.example ? `<h2>Example</h2>\n<pre class="xml-snippet"><code>${example}</code></pre>` : ""}
${
  seeAlso.length > 0
    ? `<h2>See also</h2>\n<ul class="see-also">${seeAlso
        .map(
          (e) =>
            `<li><a href="${escapeHtml(e.href)}">${escapeHtml(e.label)}</a></li>`,
        )
        .join("")}</ul>`
    : ""
}
${loc ? `<h2>Source</h2>\n<p><a href="${REPO_BLOB}/${loc.file}#L${loc.line}"><code>${loc.file}</code> · line ${loc.line}</a></p>` : ""}
</main>
</div>
<script src="../scripts/site.js" defer></script>
</body>
</html>
`;
}

function renderHeader(): string {
  return `<header class="ref-header">
  <a class="brand" href="../">SlideGlance Reference</a>
  <a class="ref-back" href="../../../build/">← Back to Build</a>
</header>`;
}

export function renderIndexPage(model: ReferenceModel): string {
  const nodeCards = model.nodes.map((n) => renderCard(n)).join("");
  const metaCards = model.meta.map((m) => renderCard(m)).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Builder XML Reference</title>
<link rel="stylesheet" href="./styles.css" />
${FOUC_SCRIPT}
</head>
<body class="ref-page ref-index">
${renderHeader()}
<main class="ref-content">
  <h1>Builder XML Reference</h1>
  <p class="ref-lede">
    <code>${model.namespace}</code> ·
    ${model.nodes.length} nodes · ${model.meta.length} meta ·
    v${escapeHtml(model.packageVersion)}
  </p>
  <label class="ref-filter">
    <input id="ref-q" type="search"
      placeholder="Filter — name, attribute, description..."
      autocomplete="off" spellcheck="false" />
    <kbd aria-hidden="true">/</kbd>
  </label>
  <p class="ref-filter-count" data-count>${model.nodes.length + model.meta.length} of ${model.nodes.length + model.meta.length} elements</p>

  <h2>Visual nodes</h2>
  <div class="ref-grid">${nodeCards}</div>

  <h2>Meta &amp; composition</h2>
  <div class="ref-grid">${metaCards}</div>

  <p class="ref-empty" hidden aria-live="polite">
    No elements match <code data-empty-q></code>.
  </p>
</main>
<script src="./scripts/site.js" defer></script>
</body>
</html>
`;
}

function renderCard(
  node: CompiledNodeDefinition | CompiledMetaDefinition,
): string {
  const slug = node.tag.toLowerCase();
  const attrNames = Object.keys(node.attributes ?? {})
    .join(" ")
    .toLowerCase();
  const haystack = `${node.tag} ${node.description ?? ""} ${attrNames}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const attrCount = Object.keys(node.attributes ?? {}).length;
  const children = "children" in node ? node.children : {};
  const childCount = Object.keys(children).length;
  const meta = `${attrCount} attrs · ${childCount === 0 ? "no children" : `${childCount} child types`}`;
  return `<a class="ref-card" href="./${slug}/" data-tag="${node.tag}" data-haystack="${escapeHtml(haystack)}">
  <h3><code>&lt;${node.tag}&gt;</code></h3>
  <p class="ref-card-desc">${escapeHtml(node.description ?? "")}</p>
  <p class="ref-card-meta">${meta}</p>
</a>`;
}

/**
 * Visual nodes have `node.children`; meta elements do not. Return a
 * uniform record so childrenTable() can render either input.
 */
function getChildrenSpec(
  node: CompiledNodeDefinition | CompiledMetaDefinition,
): Record<string, ChildrenSpec> {
  if ("children" in node) {
    return node.children;
  }
  // meta — no children field
  return {};
}

function renderSidebar(currentTag: string, model: ReferenceModel): string {
  const link = (tag: string): string => {
    const slug = tag.toLowerCase();
    const aria = tag === currentTag ? ' aria-current="page"' : "";
    return `<li><a href="../${slug}/"${aria}><code>&lt;${tag}&gt;</code></a></li>`;
  };
  return `<nav class="ref-sidebar" aria-label="Builder elements">
<h2>Visual nodes</h2>
<ul>${model.nodes.map((n) => link(n.tag)).join("")}</ul>
<h2>Meta &amp; composition</h2>
<ul>${model.meta.map((m) => link(m.tag)).join("")}</ul>
</nav>`;
}
