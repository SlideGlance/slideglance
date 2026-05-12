import { describe, expect, it } from "vitest";
import {
  parseCxnSigil,
  parseIdSigil,
  stripSigils,
  SG_CXN_PREFIX,
  SG_ID_PREFIX,
} from "./sigils.ts";

describe("parseIdSigil", () => {
  it("parses a bare sg-id sigil", () => {
    expect(parseIdSigil(`${SG_ID_PREFIX}A`)).toEqual({ userId: "A" });
  });

  it("parses sg-id plus the trackSourcePos node# token", () => {
    expect(parseIdSigil(`${SG_ID_PREFIX}A:node#7`)).toEqual({
      userId: "A",
      nodeIdToken: "node#7",
    });
  });

  it("returns null for non-id sigils and empty input", () => {
    expect(parseIdSigil(undefined)).toBeNull();
    expect(parseIdSigil("")).toBeNull();
    expect(parseIdSigil("node#5")).toBeNull();
    expect(parseIdSigil("sg-cxn:A#right>B#left:elbow:bentConnector3")).toBeNull();
  });
});

describe("parseCxnSigil", () => {
  it("parses a full connector sigil", () => {
    const sig = parseCxnSigil(
      `${SG_CXN_PREFIX}A#right>B#left:elbow:bentConnector3`,
    );
    expect(sig).toEqual({
      from: "A",
      fromSide: "right",
      to: "B",
      toSide: "left",
      kind: "elbow",
      preset: "bentConnector3",
    });
  });

  it("accepts straightConnector1 as a preset value", () => {
    const sig = parseCxnSigil(
      `${SG_CXN_PREFIX}A#top>B#bottom:straight:straightConnector1`,
    );
    expect(sig?.preset).toBe("straightConnector1");
  });

  it("rejects unknown sides / kinds", () => {
    expect(
      parseCxnSigil(`${SG_CXN_PREFIX}A#diagonal>B#left:elbow:bentConnector3`),
    ).toBeNull();
    expect(
      parseCxnSigil(`${SG_CXN_PREFIX}A#right>B#left:zigzag:bentConnector3`),
    ).toBeNull();
  });

  it("returns null on structural mismatches", () => {
    expect(parseCxnSigil(`${SG_CXN_PREFIX}AB`)).toBeNull();
    expect(parseCxnSigil(`${SG_CXN_PREFIX}A#right`)).toBeNull();
    expect(parseCxnSigil(undefined)).toBeNull();
  });
});

describe("stripSigils", () => {
  it("strips sg-id while preserving the source-position token", () => {
    expect(stripSigils(`${SG_ID_PREFIX}A:node#7`)).toBe("node#7");
  });

  it("clears a bare sg-id name to empty string", () => {
    expect(stripSigils(`${SG_ID_PREFIX}A`)).toBe("");
  });

  it("clears a sg-cxn name entirely", () => {
    expect(
      stripSigils(`${SG_CXN_PREFIX}A#right>B#left:elbow:bentConnector3`),
    ).toBe("");
  });

  it("leaves unrecognised names unchanged", () => {
    expect(stripSigils("Picture 1")).toBe("Picture 1");
    expect(stripSigils("")).toBe("");
    expect(stripSigils(undefined)).toBe("");
  });
});
