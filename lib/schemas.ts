import { z } from 'zod';

// Runtime shapes for third-party payloads: DEX Screener, GeckoTerminal, X and
// TikTok oEmbed. These are deliberately lenient. Providers add, rename and
// re-type fields without notice, so every field the application reads is
// optional, unknown fields pass through untouched, and a malformed entry is
// dropped rather than failing the whole response. What is *not* lenient is the
// envelope: a response that is not recognisably the right shape still throws, so
// it surfaces in the coverage report instead of silently reading as "no results".
//
// Numeric fields stay `unknown` on purpose. Providers send numbers as strings
// (`priceUsd`), and `num()` in ./domain already does the coercion; re-declaring
// them as numbers here would reject valid payloads.

const str = z.string().optional().catch(undefined);
const val = z.unknown();

/** Array that drops entries the item schema rejects, instead of failing outright. */
const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item.nullable().catch(null))
    .transform((xs) => xs.filter((x): x is z.output<T> => x !== null));

const h24 = z.object({ h24: val }).passthrough().optional().catch(undefined);

// --- DEX Screener -----------------------------------------------------------

const dexPair = z
  .object({
    chainId: str,
    url: str,
    priceUsd: val,
    pairCreatedAt: val,
    baseToken: z
      .object({ address: str, name: str, symbol: str })
      .passthrough()
      .optional()
      .catch(undefined),
    liquidity: z.object({ usd: val }).passthrough().optional().catch(undefined),
    volume: h24,
    priceChange: h24,
    info: z
      .object({ socials: list(z.object({ url: str }).passthrough()).optional().catch(undefined) })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

/** Search returns `{pairs:[...]}`; the token-pairs endpoint returns a bare array. */
export const dexPairsSchema = z.union([
  list(dexPair),
  z
    .object({ pairs: list(dexPair).optional() })
    .passthrough()
    .transform((d) => d.pairs ?? []),
]);

export const dexMetasSchema = list(
  z.object({ slug: str, name: str, tokenCount: val }).passthrough()
);

// --- GeckoTerminal ----------------------------------------------------------

export const geckoPoolsSchema = z
  .object({
    included: list(
      z
        .object({
          id: str,
          attributes: z
            .object({ address: str, name: str, symbol: str })
            .passthrough()
            .optional()
            .catch(undefined),
        })
        .passthrough()
    ).optional(),
    data: list(
      z
        .object({
          attributes: z
            .object({
              name: str,
              address: str,
              base_token_price_usd: val,
              reserve_in_usd: val,
              pool_created_at: str,
              volume_usd: h24,
              price_change_percentage: h24,
            })
            .passthrough()
            .optional()
            .catch(undefined),
          relationships: z
            .object({
              base_token: z
                .object({
                  data: z.object({ id: str }).passthrough().optional().catch(undefined),
                })
                .passthrough()
                .optional()
                .catch(undefined),
            })
            .passthrough()
            .optional()
            .catch(undefined),
        })
        .passthrough()
    ).optional(),
  })
  .passthrough();

// --- X ----------------------------------------------------------------------

const xTweet = z
  .object({
    id: str,
    text: str,
    author_id: str,
    created_at: str,
    entities: z
      .object({
        hashtags: list(z.object({ tag: str }).passthrough()).optional().catch(undefined),
        urls: list(z.object({ expanded_url: str, unwound_url: str }).passthrough())
          .optional()
          .catch(undefined),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    public_metrics: z
      .object({ impression_count: val, like_count: val })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

export type XTweet = z.output<typeof xTweet>;

const xEnvelope = {
  includes: z
    .object({ users: list(z.object({ id: str, username: str }).passthrough()).optional() })
    .passthrough()
    .optional()
    .catch(undefined),
  meta: z.object({ next_token: str, result_count: val }).passthrough().optional().catch(undefined),
  errors: z.array(z.unknown()).optional().catch(undefined),
};

/** Discovery view: best-effort, malformed posts are skipped. */
export const xSearchSchema = z.object({ data: list(xTweet).optional(), ...xEnvelope }).passthrough();
export type XSearch = z.output<typeof xSearchSchema>;

/**
 * Incremental collector view: the array is NOT filtered. scanXBounded inspects
 * every returned post and retains its cursor if any of them is malformed, so
 * silently dropping entries here would defeat that check.
 */
export const xPageSchema = z.object({ data: z.array(xTweet).optional(), ...xEnvelope }).passthrough();

// --- TikTok -----------------------------------------------------------------

export const tiktokOembedSchema = z.object({ title: str, author_name: str }).passthrough();

/** Parse a provider payload, reporting the source rather than a zod stack. */
export function parseProvider<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  source: string
): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw Error(`${source} returned an unexpected response shape.`);
  return parsed.data;
}
