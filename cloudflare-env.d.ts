declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FRONT_STANDALONE_USER_ID?: string;
    FRONT_COMMERCE_API_KEY?: string;
    FRONT_COMMERCE_OWNER_ID?: string;
    FRONT_BRIDGE_API_KEY?: string;
  }
}
