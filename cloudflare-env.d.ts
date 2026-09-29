declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Service-to-service secret used only by the isolated Front-Commerce API. */
    FRONT_COMMERCE_API_KEY?: string;
    /** Front owner whose evidence store the service integration is allowed to read. */
    FRONT_COMMERCE_OWNER_ID?: string;
  }
}
