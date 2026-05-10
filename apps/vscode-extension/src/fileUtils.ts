import * as vscode from "vscode";

/** SlideGlance builder XML namespace. Documents are identified by either a
 *  `.sgx` file extension or by declaring this namespace on their root
 *  element (allows generic `.xml` files to opt in via xmlns). */
export const SLIDEGLANCE_NAMESPACE = "urn:slideglance:builder:v1";

const NS_PATTERN = new RegExp(
  `xmlns\\s*=\\s*["']${SLIDEGLANCE_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
);
const HEAD_BYTES = 4096;

/** Returns true when the file's name ends in the official `.sgx` extension. */
export function isSgxFile(fileName: string): boolean {
  return fileName.endsWith(".sgx");
}

/**
 * Returns true when the document is a slide builder XML — either by file
 * extension (`.sgx`) or by declaring the `urn:slideglance:builder:v1`
 * namespace on its root element. The namespace check scans only the first
 * 4 KB of the buffer to keep the path fast for large XML payloads.
 */
export function isSlideXmlDocument(doc: vscode.TextDocument): boolean {
  if (isSgxFile(doc.fileName)) return true;
  if (doc.languageId !== "xml") return false;
  const head = doc.getText().slice(0, HEAD_BYTES);
  return NS_PATTERN.test(head);
}
