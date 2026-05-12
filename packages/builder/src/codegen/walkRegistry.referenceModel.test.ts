import { describe, expect, it } from "vitest";
import { buildReferenceModel } from "./walkRegistry.ts";

describe("buildReferenceModel", () => {
  const model = buildReferenceModel();

  it("exposes namespace + package version", () => {
    expect(model.namespace).toBe("urn:slideglance:builder:v1");
    expect(model.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(model.generatedAt).toBe("");
  });

  it("preserves registry counts (16 nodes + 13 meta)", () => {
    expect(model.nodes).toHaveLength(16);
    expect(model.meta).toHaveLength(13);
  });
});
