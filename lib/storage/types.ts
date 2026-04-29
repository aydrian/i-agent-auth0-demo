export type PutResult = {
  url: string;
  pathname: string;
  contentType: string;
};

export type PutOptions = {
  contentType?: string;
};

export type StorageDriver = {
  put: (
    name: string,
    body: ArrayBuffer | Buffer,
    opts?: PutOptions
  ) => Promise<PutResult>;
};
