/**
 * Upload checks that don't depend on Firebase: what an image really is (by its leading
 * bytes, since browser-supplied types and file names can lie) and where it may be stored.
 */

export interface ImageKind {
  type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  ext: "jpg" | "png" | "gif" | "webp";
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Raster formats only. SVG is refused on purpose: it can carry script. */
const SIGNATURES: (ImageKind & { test: (b: Uint8Array) => boolean })[] = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: "png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { type: "image/gif", ext: "gif", test: (b) => ascii(b, 0, 4) === "GIF8" },
  { type: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
];

export function detectImageType(bytes: Uint8Array): ImageKind | null {
  const match = SIGNATURES.find((s) => s.test(bytes));
  return match ? { type: match.type, ext: match.ext } : null;
}

/** "lounges/abc/menu" style: 1–5 segments of letters, digits, "_" or "-"; no "..", no leading or trailing slash. */
const FOLDER = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,4}$/;

export function isSafeFolder(folder: string): boolean {
  return FOLDER.test(folder);
}
