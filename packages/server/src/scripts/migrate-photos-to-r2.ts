/**
 * One-off migration: upload inline base64 photo_url values to R2
 * and replace them with R2 object keys.
 *
 * Usage:  npx tsx packages/server/src/scripts/migrate-photos-to-r2.ts
 */
import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import postgres from "postgres";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL);

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});
const BUCKET = process.env.R2_BUCKET || "gardoo-photos";

/** Convert a base64 data URL to a Buffer + content type */
function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Invalid data URL");
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadToR2(key: string, buffer: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

interface Row {
  id: string;
  photo_url: string;
}

async function migrateTable(table: string) {
  const rows = await sql<Row[]>`
    SELECT id, photo_url FROM ${sql(table)}
    WHERE photo_url LIKE 'data:%'
  `;

  console.log(`${table}: ${rows.length} base64 photos to migrate`);

  for (const row of rows) {
    try {
      const { buffer, contentType } = parseDataUrl(row.photo_url);
      const ext = contentType === "image/png" ? "png" : "jpg";
      const key = `${table}/${row.id}/${randomUUID()}.${ext}`;

      await uploadToR2(key, buffer, contentType);

      await sql`
        UPDATE ${sql(table)} SET photo_url = ${key} WHERE id = ${row.id}
      `;

      console.log(`  ✓ ${row.id} → ${key} (${(buffer.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  ✗ ${row.id}: ${err}`);
    }
  }
}

async function main() {
  console.log("Migrating base64 photos to R2...\n");

  await migrateTable("zones");
  await migrateTable("plants");
  await migrateTable("care_logs");

  console.log("\nDone!");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
