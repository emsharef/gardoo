import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.STORAGE_S3_REGION || "auto",
  endpoint: process.env.STORAGE_S3_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.STORAGE_S3_ACCESS_KEY!,
    secretAccessKey: process.env.STORAGE_S3_SECRET_KEY!,
  },
  forcePathStyle: true, // Required for S3-compatible endpoints (R2, Supabase Storage)
});

const BUCKET = process.env.STORAGE_S3_BUCKET || "gardoo-photos";

export async function getUploadUrl(key: string, contentType = "image/jpeg"): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 min
}

export async function getReadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}
