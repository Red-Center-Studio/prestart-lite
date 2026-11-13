/**
 * Photo uploads. Objects in R2 are never public: keys are random, and the only way to view a photo is the
 * /photos/check/:id or /photos/defect/:id route, which checks permission on the record first.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export type PhotoCheck = { ok: true; file: File | null } | { ok: false; message: string };

/** Validates an uploaded photo field. An empty file input counts as no photo. */
export function validatePhoto(value: unknown): PhotoCheck {
  if (value === undefined || value === null || value === "") return { ok: true, file: null };
  if (!(value instanceof File)) return { ok: false, message: "That photo could not be read. Try choosing it again." };
  if (value.size === 0) return { ok: true, file: null };
  if (value.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "That photo is too big. Photos must be 10 MB or smaller." };
  }
  if (!(ACCEPTED_TYPES as readonly string[]).includes(value.type)) {
    return { ok: false, message: "Photos must be JPEG, PNG, WebP or HEIC images." };
  }
  return { ok: true, file: value };
}

export async function storePhoto(bucket: R2Bucket, prefix: "checks", file: File): Promise<string> {
  const key = `${prefix}/${crypto.randomUUID()}`;
  // At most 10 MB, so reading it into memory is fine and gives R2 the exact length it needs.
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return key;
}

/** Streams a stored photo back to an allowed viewer. */
export async function photoResponse(bucket: R2Bucket, key: string): Promise<Response | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  return new Response(obj.body, { headers });
}
