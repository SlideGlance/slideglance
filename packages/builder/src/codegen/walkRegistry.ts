/**
 * Codegen helpers — flatten the compiled registry into a structure each
 * emitter can iterate independently.
 *
 * The compiled registry already exposes ALL_COMPILED_NODES / ALL_COMPILED_META;
 * this module wraps them with computed projections (root elements, container
 * categories, per-coerce simpleType mapping) so each emitter does not have to
 * recompute them.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_COMPILED_NODES,
  ALL_COMPILED_META,
  validateCompiledRegistry,
} from "../registry/compiled/index.ts";
import type {
  CompiledNodeDefinition,
  CoerceType,
} from "../registry/defineNode.ts";
import type { CompiledMetaDefinition } from "../registry/defineMeta.ts";
import { SEE_ALSO, type SeeAlsoEntry } from "./seeAlso.ts";

interface WalkedRegistry {
  readonly nodes: readonly CompiledNodeDefinition[];
  readonly meta: readonly CompiledMetaDefinition[];
  /** Root-eligible element tags (SlideGlance, Fragment). */
  readonly roots: readonly string[];
  /** Tags accepted as a generic POM node child (used in xs:choice for containers). */
  readonly nodeTags: readonly string[];
}

export function walkRegistry(): WalkedRegistry {
  validateCompiledRegistry();

  const nodes = ALL_COMPILED_NODES;
  const meta = ALL_COMPILED_META;
  const roots = nodes.filter((n) => n.root).map((n) => n.tag);

  // builder node tags = nodes that have a `type` discriminant; excludes
  // document containers (SlideGlance/Slide/Fragment).
  const nodeTags = nodes.filter((n) => n.type !== undefined).map((n) => n.tag);

  return { nodes, meta, roots, nodeTags };
}

/** Map a coerce type to a named XSD simpleType (or null for inline xs:string). */
export function coerceToXsdSimpleType(coerce: CoerceType): {
  /** Named simpleType reference (with `b:` prefix) or null when inline-only. */
  named: string | null;
  /** Built-in xs primitive used inline when `named` is null. */
  primitive: string;
} {
  switch (coerce) {
    case "number":
      return { named: null, primitive: "xs:double" };
    case "boolean":
      return { named: "b:Boolean", primitive: "xs:boolean" };
    case "string":
    case "json":
      return { named: null, primitive: "xs:string" };
    case "length":
      return { named: "b:Length", primitive: "xs:string" };
    case "color":
    case "iconColor":
      return { named: "b:Color", primitive: "xs:string" };
    case "padding":
      return { named: "b:Padding", primitive: "xs:string" };
    case "border":
      return { named: "b:BorderStyle", primitive: "xs:string" };
    case "fill":
      return { named: "b:FillStyle", primitive: "xs:string" };
    case "shadow":
      return { named: "b:ShadowStyle", primitive: "xs:string" };
    case "underline":
      return { named: "b:Underline", primitive: "xs:string" };
    case "imageSizing":
      return { named: "b:ImageSizing", primitive: "xs:string" };
    case "lineArrow":
      return { named: "b:LineArrow", primitive: "xs:string" };
    case "borderDash":
      return { named: "b:BorderDash", primitive: "xs:string" };
    case "shapeType":
      return { named: "b:ShapeType", primitive: "xs:string" };
    case "bulletNumberType":
      return { named: "b:BulletNumberType", primitive: "xs:string" };
    case "iconName":
      return { named: "b:IconName", primitive: "xs:string" };
    case "iconVariant":
      return { named: "b:IconVariant", primitive: "xs:string" };
    case "alignSelf":
    case "alignItems":
    case "justifyContent":
    case "flexWrap":
    case "positionType":
    case "textAlign":
    case "vAlign":
      // These are simple enums, emitted inline via the attribute's `enum` field.
      return { named: null, primitive: "xs:string" };
  }
}

/**
 * Aggregate reference model consumed by the HTML emitter. Built on top of
 * `walkRegistry()`, this adds metadata (namespace, package version), a
 * pre-parsed see-also table, and placeholders for the reverse index +
 * source locations populated by later tasks.
 */
export interface ReferenceModel {
  readonly generatedAt: string;
  readonly packageVersion: string;
  readonly namespace: string;
  readonly nodes: readonly CompiledNodeDefinition[];
  readonly meta: readonly CompiledMetaDefinition[];
  readonly usedBy: ReadonlyMap<
    string,
    ReadonlyArray<{ parent: string; cardinality: string }>
  >;
  readonly seeAlso: ReadonlyMap<string, ReadonlyArray<SeeAlsoEntry>>;
  readonly sourceLocations: ReadonlyMap<string, { file: string; line: number }>;
}

const BUILDER_NS = "urn:slideglance:builder:v1";

function readPackageVersion(): string {
  const HERE = fileURLToPath(import.meta.url);
  const pkgPath = resolve(HERE, "../../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export function buildReferenceModel(): ReferenceModel {
  const r = walkRegistry();
  return {
    generatedAt: "",
    packageVersion: readPackageVersion(),
    namespace: BUILDER_NS,
    nodes: r.nodes,
    meta: r.meta,
    // Populated by subsequent tasks (T4 usedBy, T5 sourceLocations).
    usedBy: new Map(),
    seeAlso: new Map(Object.entries(SEE_ALSO)),
    sourceLocations: new Map(),
  };
}
