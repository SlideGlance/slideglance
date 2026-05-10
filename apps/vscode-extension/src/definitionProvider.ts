/**
 * Cmd+click / F12 navigation for slide builder XML attributes.
 *
 * - `<Use template="X" .../>`  → jumps to the matching `<Template name="X">`.
 * - `class="X Y Z"`            → each space-separated token jumps to the
 *                                matching `<Style name="...">`. Tokens
 *                                containing template placeholders (`{...}`)
 *                                or non-identifier characters are skipped.
 * - `<Import src="path"/>`     → (and any other `src="..."`) jumps to that
 *                                file.
 *
 * Template / Style lookups scan every `.sgx` / `.xml` file in the workspace
 * because they are typically defined in sibling files (e.g. `styles/colors.xml`,
 * `templates/page.xml`) that the current document does not import directly —
 * the common ancestor (`main.sgx`) is what stitches them together.
 *
 * Two providers are registered so both Cmd+click navigation *and* the visual
 * underline appear:
 *
 *   - `DocumentLinkProvider` renders the dotted underline in the editor and
 *     handles Cmd+click. Its target is a `command:vscode.open` URI that
 *     carries the precise selection range (DocumentLink.target alone cannot
 *     encode a line position).
 *   - `DefinitionProvider` mirrors the same lookup so F12 / "Go to Definition"
 *     also works when the cursor is inside the attribute value.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const ATTR_RE = /(template|src|class)\s*=\s*"([^"]*)"/g;
const TEMPLATE_DEF_RE = /<Template\b[^>]*?\bname\s*=\s*"([^"]+)"/g;
const STYLE_DEF_RE = /<Style\b[^>]*?\bname\s*=\s*"([^"]+)"/g;
// Bare identifier — a class token must match this to be considered for
// lookup. Skips tokens like `{surface}` (template placeholders) and any
// stray punctuation, which would never match a `<Style name="...">`.
const CLASS_TOKEN_RE = /[A-Za-z_][A-Za-z0-9_-]*/g;

interface DefLocation {
  file: string;
  line: number;
  character: number;
  nameLength: number;
}

function readFileContent(absolute: string): string | undefined {
  const open = vscode.workspace.textDocuments.find(
    (d) => d.uri.fsPath === absolute,
  );
  if (open) return open.getText();
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function lineCharFromIndex(
  text: string,
  idx: number,
): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < idx; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: idx - lineStart };
}

// ===== Workspace-wide template & style indices =====
//
// Cached because provideDocumentLinks runs on every edit and a workspace
// scan per call would chew CPU on larger decks. Invalidated by the
// file-system watcher and the text-edit hook registered in
// `registerNavigationProviders`. Built in a single pass because templates
// and styles share the same scan path.
interface NameIndex {
  templates: Map<string, DefLocation>;
  styles: Map<string, DefLocation>;
}

let indexCache: NameIndex | undefined;

function invalidateIndex(): void {
  indexCache = undefined;
}

function recordMatch(
  index: Map<string, DefLocation>,
  match: RegExpMatchArray,
  content: string,
  filePath: string,
): void {
  const name = match[1];
  // First definer wins — same precedence as the parser's collectStyles /
  // collectTemplates: subsequent declarations are silently ignored.
  if (index.has(name)) return;
  const nameAttrIdx = match.index! + match[0].indexOf(`"${name}"`) + 1;
  const { line, character } = lineCharFromIndex(content, nameAttrIdx);
  index.set(name, {
    file: filePath,
    line,
    character,
    nameLength: name.length,
  });
}

async function getIndex(): Promise<NameIndex> {
  if (indexCache) return indexCache;
  const templates = new Map<string, DefLocation>();
  const styles = new Map<string, DefLocation>();
  const files = await vscode.workspace.findFiles(
    "**/*.{sgx,xml}",
    "**/node_modules/**",
  );
  for (const uri of files) {
    const content = readFileContent(uri.fsPath);
    if (!content) continue;
    for (const m of content.matchAll(TEMPLATE_DEF_RE)) {
      recordMatch(templates, m, content, uri.fsPath);
    }
    for (const m of content.matchAll(STYLE_DEF_RE)) {
      recordMatch(styles, m, content, uri.fsPath);
    }
  }
  indexCache = { templates, styles };
  return indexCache;
}

// ===== Per-attribute helpers =====

type AttrName = "template" | "src" | "class";

interface AttrHit {
  name: AttrName;
  /** For `template`/`src`: the whole quoted value. For `class`: a single token. */
  value: string;
  /** Range covering exactly the clickable text (the value or the single token). */
  range: vscode.Range;
}

/**
 * Yield one AttrHit per logical lookup target found in the value at
 * `valueStart`. Templates and src produce one hit covering the whole value;
 * class produces one hit per identifier-like whitespace-separated token, so
 * each token in `class="page big"` becomes its own underline + jump.
 */
function* hitsForAttr(
  attrName: AttrName,
  value: string,
  valueStart: number,
  toRange: (start: number, end: number) => vscode.Range,
): Generator<AttrHit> {
  if (attrName === "class") {
    // Mask `{placeholder}` runs with spaces of equal length so the tokenizer
    // ignores their inner identifiers (e.g. `class="page {surface}"` should
    // surface only `page`, not `surface`) while keeping match indices aligned
    // with the original value.
    const sanitized = value.replace(/\{[^}]*\}/g, (m) => " ".repeat(m.length));
    for (const tm of sanitized.matchAll(CLASS_TOKEN_RE)) {
      const tokStart = valueStart + tm.index!;
      const tokEnd = tokStart + tm[0].length;
      yield { name: "class", value: tm[0], range: toRange(tokStart, tokEnd) };
    }
    return;
  }
  yield {
    name: attrName,
    value,
    range: toRange(valueStart, valueStart + value.length),
  };
}

function findAttrsInDocument(document: vscode.TextDocument): AttrHit[] {
  const out: AttrHit[] = [];
  const text = document.getText();
  const toRange = (start: number, end: number): vscode.Range =>
    new vscode.Range(document.positionAt(start), document.positionAt(end));
  for (const m of text.matchAll(ATTR_RE)) {
    const value = m[2];
    if (!value) continue;
    const valueStart = m.index! + m[0].indexOf('"') + 1;
    for (const hit of hitsForAttr(
      m[1] as AttrName,
      value,
      valueStart,
      toRange,
    )) {
      out.push(hit);
    }
  }
  return out;
}

function attrAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): AttrHit | undefined {
  // Limit the scan to the cursor's line — attribute values do not span lines.
  const lineText = document.lineAt(position.line).text;
  const lineStart = document.offsetAt(new vscode.Position(position.line, 0));
  const toRange = (start: number, end: number): vscode.Range =>
    new vscode.Range(
      new vscode.Position(position.line, start - lineStart),
      new vscode.Position(position.line, end - lineStart),
    );
  for (const m of lineText.matchAll(ATTR_RE)) {
    const value = m[2];
    if (!value) continue;
    const valueStart = m.index! + m[0].indexOf('"') + 1;
    const valueEnd = valueStart + value.length;
    if (position.character < valueStart || position.character > valueEnd)
      continue;
    for (const hit of hitsForAttr(
      m[1] as AttrName,
      value,
      lineStart + valueStart,
      toRange,
    )) {
      if (hit.range.contains(position)) return hit;
    }
    // Cursor is in the value but not on any clickable token (e.g. between
    // class tokens, or inside `{placeholder}`). Fall through.
    return undefined;
  }
  return undefined;
}

interface ResolvedTarget {
  uri: vscode.Uri;
  line: number;
  character: number;
  endCharacter: number;
}

async function resolveAttrTarget(
  hit: AttrHit,
  document: vscode.TextDocument,
): Promise<ResolvedTarget | undefined> {
  if (hit.name === "src") {
    const baseDir = path.dirname(document.uri.fsPath);
    const absolute = path.resolve(baseDir, hit.value);
    if (!fs.existsSync(absolute)) return undefined;
    return {
      uri: vscode.Uri.file(absolute),
      line: 0,
      character: 0,
      endCharacter: 0,
    };
  }
  const { templates, styles } = await getIndex();
  const def =
    hit.name === "template" ? templates.get(hit.value) : styles.get(hit.value);
  if (!def) return undefined;
  return {
    uri: vscode.Uri.file(def.file),
    line: def.line,
    character: def.character,
    endCharacter: def.character + def.nameLength,
  };
}

/** Command id used by DocumentLink targets to open a file at a specific
 *  position. Built-in `vscode.open` accepts a `selection` option but the
 *  Range object loses fidelity when JSON-encoded into the command URI, so
 *  we register a thin wrapper that takes plain numbers. */
const OPEN_AT_COMMAND = "slideBuilder.openAt";

/** Build a `command:slideBuilder.openAt` URI that carries the precise
 *  position. DocumentLink.target alone cannot encode a line — only
 *  `command:` URIs can. */
function buildOpenCommandUri(target: ResolvedTarget): vscode.Uri {
  const args: [string, number, number, number] = [
    target.uri.toString(),
    target.line,
    target.character,
    target.endCharacter,
  ];
  return vscode.Uri.parse(
    `command:${OPEN_AT_COMMAND}?${encodeURIComponent(JSON.stringify(args))}`,
  );
}

async function openAt(
  uriString: string,
  line: number,
  character: number,
  endCharacter: number,
): Promise<void> {
  const uri = vscode.Uri.parse(uriString);
  const selection = new vscode.Range(line, character, line, endCharacter);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    selection,
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
}

// ===== Providers =====

const linkProvider: vscode.DocumentLinkProvider = {
  async provideDocumentLinks(document) {
    const hits = findAttrsInDocument(document);
    if (hits.length === 0) return [];
    const links: vscode.DocumentLink[] = [];
    for (const hit of hits) {
      const target = await resolveAttrTarget(hit, document);
      if (!target) continue;
      const link = new vscode.DocumentLink(
        hit.range,
        buildOpenCommandUri(target),
      );
      const tail = target.line === 0 ? "" : `:${target.line + 1}`;
      link.tooltip = `Open ${path.basename(target.uri.fsPath)}${tail}`;
      links.push(link);
    }
    return links;
  },
};

const definitionProvider: vscode.DefinitionProvider = {
  async provideDefinition(document, position) {
    const hit = attrAtPosition(document, position);
    if (!hit) return undefined;
    const target = await resolveAttrTarget(hit, document);
    if (!target) return undefined;
    const at = new vscode.Range(
      target.line,
      target.character,
      target.line,
      target.endCharacter,
    );
    return [
      {
        originSelectionRange: hit.range,
        targetUri: target.uri,
        targetRange: at,
        targetSelectionRange: at,
      } satisfies vscode.LocationLink,
    ];
  },
};

/**
 * Register both providers and the cache invalidation hooks. Selector is
 * `.sgx` + xml-language so imported fragments (which are usually plain
 * `.xml` with a `<Fragment>` root) get the same navigation.
 */
export function registerNavigationProviders(
  context: vscode.ExtensionContext,
): void {
  const selector: vscode.DocumentSelector = [
    { scheme: "file", pattern: "**/*.sgx" },
    { scheme: "file", language: "xml" },
  ];
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(selector, linkProvider),
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    vscode.commands.registerCommand(OPEN_AT_COMMAND, openAt),
  );

  // Invalidate on saved edits and on file-system events so the cached
  // template index reflects renames / new templates / deletes promptly.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{sgx,xml}");
  watcher.onDidChange(invalidateIndex);
  watcher.onDidCreate(invalidateIndex);
  watcher.onDidDelete(invalidateIndex);
  context.subscriptions.push(watcher);

  // Unsaved edits in open editors also affect template positions — the
  // cache reads via `readFileContent`, which prefers open buffers, so we
  // drop the cache on every text edit to a `.xml` / `.sgx` document.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const fp = e.document.uri.fsPath;
      if (fp.endsWith(".sgx") || fp.endsWith(".xml")) {
        invalidateIndex();
      }
    }),
  );
}
