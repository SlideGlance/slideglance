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
// `provideDocumentLinks` runs on every edit, so the index is cached per
// file rather than as one workspace-wide blob. An edit marks a single
// file stale and the next lookup re-reads that file alone; only a
// create / delete — which changes the file list, and with it the
// "first definer wins" order — forces a fresh `findFiles`. A scan per
// keystroke would re-read every `.sgx` / `.xml` in the workspace on the
// same thread the preview build runs on, so the two would compete.
interface NameIndex {
  templates: Map<string, DefLocation>;
  styles: Map<string, DefLocation>;
}

/**
 * Workspace file list in `findFiles` order. That order decides which
 * declaration wins a duplicate name, so it is preserved across
 * incremental re-reads. `undefined` means "not scanned yet".
 */
let indexedFiles: string[] | undefined;
/**
 * Parsed definitions per file, keyed by absolute path. Every path in
 * `indexedFiles` gets an entry — an unreadable file gets an empty one —
 * so membership here answers "is this file part of the index?".
 */
const fileIndices = new Map<string, NameIndex>();
/** Files whose content changed since they were last parsed. */
const staleFiles = new Set<string>();
/** Merged view over `fileIndices`; dropped whenever anything changes. */
let mergedIndex: NameIndex | undefined;
/** Bumped on every full invalidation so a scan can tell it went stale. */
let indexGeneration = 0;

/** Drop everything — the file list itself may have changed. */
function invalidateIndex(): void {
  indexGeneration++;
  indexedFiles = undefined;
  fileIndices.clear();
  staleFiles.clear();
  mergedIndex = undefined;
}

/** Re-read this one file on the next lookup. */
function invalidateFile(fsPath: string): void {
  // Only files the workspace scan covers can contribute to the index.
  // Anything else — an editor opened from outside the workspace, an
  // untitled buffer, a path under an excluded folder — is not part of
  // it and must not trigger a rescan on every keystroke.
  if (!fileIndices.has(fsPath)) return;
  staleFiles.add(fsPath);
  mergedIndex = undefined;
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

/** Read one file and collect the names it declares. */
function parseFile(fsPath: string): NameIndex {
  const templates = new Map<string, DefLocation>();
  const styles = new Map<string, DefLocation>();
  const content = readFileContent(fsPath);
  if (content) {
    for (const m of content.matchAll(TEMPLATE_DEF_RE)) {
      recordMatch(templates, m, content, fsPath);
    }
    for (const m of content.matchAll(STYLE_DEF_RE)) {
      recordMatch(styles, m, content, fsPath);
    }
  }
  return { templates, styles };
}

async function getIndex(): Promise<NameIndex> {
  if (mergedIndex) return mergedIndex;

  while (!indexedFiles) {
    const generation = indexGeneration;
    const files = await vscode.workspace.findFiles(
      "**/*.{sgx,xml}",
      "**/node_modules/**",
    );
    // A create or delete landing mid-scan makes the list stale before it
    // is ever used, so scan again instead of indexing it.
    if (generation !== indexGeneration) continue;
    indexedFiles = files.map((uri) => uri.fsPath);
    fileIndices.clear();
    staleFiles.clear();
    for (const fsPath of indexedFiles) staleFiles.add(fsPath);
  }

  for (const fsPath of staleFiles) {
    fileIndices.set(fsPath, parseFile(fsPath));
  }
  staleFiles.clear();

  const templates = new Map<string, DefLocation>();
  const styles = new Map<string, DefLocation>();
  for (const fsPath of indexedFiles) {
    const entry = fileIndices.get(fsPath);
    if (!entry) continue;
    // First definer wins across files too, matching the within-file
    // precedence `recordMatch` applies.
    for (const [name, def] of entry.templates) {
      if (!templates.has(name)) templates.set(name, def);
    }
    for (const [name, def] of entry.styles) {
      if (!styles.has(name)) styles.set(name, def);
    }
  }
  mergedIndex = { templates, styles };
  return mergedIndex;
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

  // Invalidate on file-system events so the index reflects renames / new
  // templates / deletes promptly. A content change touches one file; a
  // create or delete changes the file list, so it drops everything.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{sgx,xml}");
  watcher.onDidChange((uri) => invalidateFile(uri.fsPath));
  watcher.onDidCreate(() => invalidateIndex());
  watcher.onDidDelete(() => invalidateIndex());
  context.subscriptions.push(watcher);

  // Unsaved edits in open editors also affect template positions — the
  // index reads via `readFileContent`, which prefers open buffers, so an
  // edit re-reads that one file on the next lookup.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const fp = e.document.uri.fsPath;
      if (fp.endsWith(".sgx") || fp.endsWith(".xml")) {
        invalidateFile(fp);
      }
    }),
  );
}
