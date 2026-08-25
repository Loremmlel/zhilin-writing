declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    BOOTSTRAP_ADMIN_EMAIL?: string;
  }
}
