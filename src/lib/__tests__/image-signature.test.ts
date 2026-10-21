import { describe, expect, it } from "vitest";
import { detectImageType, isSafeFolder } from "../image-signature";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("detectImageType", () => {
  it("recognises JPEG, PNG, GIF and WebP by content", () => {
    expect(detectImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ type: "image/jpeg", ext: "jpg" });
    expect(detectImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ type: "image/png", ext: "png" });
    expect(detectImageType(bytes("GIF89a"))).toEqual({ type: "image/gif", ext: "gif" });
    expect(detectImageType(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toEqual({ type: "image/webp", ext: "webp" });
  });

  it("refuses SVG, HTML, other RIFF files and truncated data", () => {
    expect(detectImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageType(bytes("<!doctype html><html>"))).toBeNull();
    expect(detectImageType(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt "))).toBeNull();
    expect(detectImageType(bytes([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe("isSafeFolder", () => {
  it("accepts plain nested folders", () => {
    expect(isSafeFolder("menu")).toBe(true);
    expect(isSafeFolder("lounges/cmve4ur8i00052cu99r8t28e4/menu")).toBe(true);
  });

  it("rejects traversal, absolute paths and odd characters", () => {
    for (const bad of ["", "../menu", "lounges/../x", "/menu", "menu/", "a//b", "menu?x=1", "مينيو", "a/b/c/d/e/f"]) {
      expect(isSafeFolder(bad), bad).toBe(false);
    }
  });
});
