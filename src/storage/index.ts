export {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

let google: any;
let drive_v3: any;
try {
  const g = await import("googleapis");
  google = g.google;
  drive_v3 = g.drive_v3;
} catch {
  google = undefined;
  drive_v3 = undefined;
}

export { google, drive_v3 };
