import { put } from "@vercel/blob";

import type { PutOptions, PutResult, StorageDriver } from "./types";

export function createVercelBlobDriver(): StorageDriver {
  return {
    async put(
      name: string,
      body: ArrayBuffer | Buffer,
      opts?: PutOptions
    ): Promise<PutResult> {
      const result = await put(name, body, {
        access: "public",
        contentType: opts?.contentType,
      });

      return {
        url: result.url,
        pathname: result.pathname,
        contentType: result.contentType,
      };
    },
  };
}
