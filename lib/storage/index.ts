import { createS3Driver } from "./s3";
import type { StorageDriver } from "./types";
import { createVercelBlobDriver } from "./vercel-blob";

let cached: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (cached) {
    return cached;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cached = createVercelBlobDriver();
    return cached;
  }

  if (process.env.S3_ENDPOINT) {
    cached = createS3Driver();
    return cached;
  }

  throw new Error(
    "No blob storage configured: set BLOB_READ_WRITE_TOKEN (Vercel BLOB) or S3_ENDPOINT (S3/MinIO)"
  );
}

export type { PutResult, StorageDriver } from "./types";
