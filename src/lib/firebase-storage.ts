import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminStorage, isFirebaseAdminConfigured } from "@/lib/firebase-admin";
import { isFirebaseStorageEnabled } from "@/lib/env";
import { detectImageType, isSafeFolder } from "@/lib/image-signature";

/** 5 MB: plenty for a menu photo; keep next.config's serverActions.bodySizeLimit above it. */
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export type UploadErrorCode = "NOT_CONFIGURED" | "INVALID_FOLDER" | "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "UPLOAD_FAILED";

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "UploadError";
  }
}

/**
 * Uploads a product/canteen image to Firebase Storage with the Admin SDK and returns a
 * public download URL (a Firebase download-token URL, so the bucket's rules can keep
 * client reads and writes closed). Server-side only: call it from a Server Action after
 * checking the caller may change that lounge's menu.
 */
export async function uploadProductImage(file: File, folderName: string): Promise<string> {
  if (!isFirebaseAdminConfigured || !isFirebaseStorageEnabled) throw new UploadError("NOT_CONFIGURED");
  if (!isSafeFolder(folderName)) throw new UploadError("INVALID_FOLDER");
  if (file.size === 0) throw new UploadError("EMPTY");
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) throw new UploadError("TOO_LARGE");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImageType(bytes);
  if (!kind) throw new UploadError("UNSUPPORTED_TYPE");

  const bucket = getAdminStorage().bucket();
  const path = `${folderName}/${randomUUID()}.${kind.ext}`;
  const token = randomUUID();
  try {
    await bucket.file(path).save(Buffer.from(bytes), {
      resumable: false,
      contentType: kind.type,
      metadata: {
        // Each upload has a fresh name, so it can be cached forever.
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: "inline",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  } catch (cause) {
    throw new UploadError("UPLOAD_FAILED", { cause });
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}
