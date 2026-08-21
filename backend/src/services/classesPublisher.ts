import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ClassesFile } from '../types/classes';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Round-trips the public class catalog on the CDN bucket.
 *
 * There is no private state alongside it, unlike the program and article
 * pipelines: everything the crawl learns is published, so the catalog is
 * also the record of what the last run saw. Reading it back is needed by the
 * spots refresh anyway, which patches availability into it.
 *
 * The cache header is shorter than the events feed's hour. Spot counts are
 * the one number people act on immediately, and a stale one is worse than a
 * slightly chattier CDN.
 */
export class ClassesPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  private key(year: number): string {
    return `${this.prefix}/classes-${year}.json`;
  }

  async loadCatalog(year: number): Promise<ClassesFile | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(year) }),
      );
      return JSON.parse(await out.Body!.transformToString()) as ClassesFile;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  async publishCatalog(year: number, file: ClassesFile): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(year),
        Body: JSON.stringify(file),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }),
    );
  }
}
