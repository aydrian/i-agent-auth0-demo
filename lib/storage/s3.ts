import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { PutOptions, PutResult, StorageDriver } from "./types";

type S3Config = {
  endpoint: string;
  publicUrl: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function readConfig(): S3Config {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!(endpoint && bucket && accessKeyId && secretAccessKey)) {
    throw new Error(
      "S3 storage is not configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY"
    );
  }

  return {
    endpoint,
    publicUrl: process.env.S3_PUBLIC_URL ?? endpoint,
    bucket,
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
}

function buildPublicUrl(config: S3Config, key: string): string {
  const base = config.publicUrl.replace(/\/+$/, "");
  return `${base}/${config.bucket}/${key}`;
}

export function createS3Driver(): StorageDriver {
  const config = readConfig();
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });

  return {
    async put(
      name: string,
      body: ArrayBuffer | Buffer,
      opts?: PutOptions
    ): Promise<PutResult> {
      const contentType = opts?.contentType ?? "application/octet-stream";
      const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: name,
          Body: bodyBuffer,
          ContentType: contentType,
          ACL: "public-read",
        })
      );

      return {
        url: buildPublicUrl(config, name),
        pathname: `/${config.bucket}/${name}`,
        contentType,
      };
    },
  };
}
