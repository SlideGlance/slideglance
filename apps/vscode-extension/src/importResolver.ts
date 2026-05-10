import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ImportResolver } from "@slideglance/builder";

/**
 * Build a sync ImportResolver that resolves `<Import src="..."/>` paths
 * relative to the importing file's directory. Prefers the in-memory buffer
 * from VS Code when the target file is open — this makes the preview reflect
 * unsaved edits in imported files instead of using the on-disk version.
 *
 * When `tracker` is supplied, every successfully resolved absolute path is
 * added to it. The preview panel uses this to know which files, if edited,
 * should retrigger a rebuild even though they are not the root document.
 */
export function createFsImportResolver(tracker?: Set<string>): ImportResolver {
  return (src, fromPath) => {
    const baseDir = fromPath ? path.dirname(fromPath) : process.cwd();
    const absolute = path.resolve(baseDir, src);
    tracker?.add(absolute);

    const openDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.fsPath === absolute,
    );
    if (openDoc) {
      return { content: openDoc.getText(), path: absolute };
    }

    const content = fs.readFileSync(absolute, "utf8");
    return { content, path: absolute };
  };
}
