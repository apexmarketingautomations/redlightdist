import { createHmac, timingSafeEqual } from "node:crypto";

export interface UploadRequest {
  creatorId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  checksumSha256?: string;
}
export interface SignedUpload { url: string; headers?: Record<string,string>; expiresAt: Date; }
export interface SignedDownload { url: string; expiresAt: Date; }

export interface StorageProvider {
  readonly name: string;
  createUpload(request: UploadRequest): Promise<SignedUpload>;
  createDownload(input: {creatorId:string; objectKey:string; expiresInSeconds:number}): Promise<SignedDownload>;
  deleteObject(input: {creatorId:string; objectKey:string}): Promise<void>;
}

export function assertMediaType(contentType: string, allowed: readonly string[]): void {
  if (!allowed.includes(contentType.toLowerCase())) throw new Error("UNSUPPORTED_MEDIA_TYPE");
}
export function assertUploadSize(byteSize: number, limit: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > limit) throw new Error("UPLOAD_SIZE_LIMIT");
}

/**
 * Application-level fallback token for a protected media gateway. Object stores should use native signed URLs when configured.
 */
export function signMediaGrant(input: {creatorId:string; assetId:string; expiresAt:number; secret:string}): string {
  const payload = `${input.creatorId}.${input.assetId}.${input.expiresAt}`;
  const signature = createHmac("sha256", input.secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
export function verifyMediaGrant(token: string, secret: string, nowSeconds = Math.floor(Date.now()/1000)): {creatorId:string;assetId:string}|null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [creatorId,assetId,expiresRaw,signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!creatorId || !assetId || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !signature) return null;
  const payload = `${creatorId}.${assetId}.${expiresAt}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a=Buffer.from(signature); const b=Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
  return {creatorId,assetId};
}
