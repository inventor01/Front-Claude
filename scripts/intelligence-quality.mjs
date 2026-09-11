const GENERIC = new Set('meme memes viral virality reaction reactions clip clips trend trends trending story stories update updates breaking news funny internet tiktok twitter tweet tweets social media creator creators fyp foryou foryoupage hashtag hashtags caption video videos photo photos sound user username account profile'.split(' '));
const BROAD = new Set('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial'.split(' '));
const COMMON_SINGLE = new Set('never always sometimes often usually maybe probably perhaps someone somebody anyone anybody everyone everybody something anything everything nothing somewhere anywhere everywhere nowhere trade trading buy buying sell selling blue red green black white orange yellow pink purple brown grey gray dark light big small old young high low hot cold fast slow early late long short better worse best worst free paid money price prices cost costs deal deals work works working worked use used using try trying tried start started starting stop stopped stopping keep keeps keeping kept need needs needed want wants wanted help helps helped find finds found show shows showing see sees seeing look looks looking tell tells told ask asks asked say says said feel feels felt think thinks thought know knows knew believe believes believed love loves loved hate hates hated like likes liked follow follows followed watch watches watched share shares shared click clicks clicked open opens opened close closes closed run runs running ran play plays playing played move moves moving moved turn turns turned call calls called name names named word words post posts video videos photo photos account accounts profile profiles creator creators user users person persons people guy guys girl girls man men woman women kid kids child children friend friends bro dude team teams game games song songs movie movies food foods car cars phone phones app apps site sites page pages link links number numbers thing things stuff part parts way ways place places home homes room rooms school schools job jobs business businesses company companies product products service services market markets coin coins token tokens story stories news update updates topic topics idea ideas question questions answer answers comment comments reply replies'.split(' '));
const PLATFORM_TAG = new Set('fyp fy foryou foryoupage viral viralvideo viralvideos trending trend tiktok tiktokviral tiktoktrend tiktoktrending capcut edit edits funny comedy humor explore explorepage xyzbca xyzabc fypppp'.split(' '));

export function normalizeIntelligenceLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/^#/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function intelligenceLabelTokens(value) {
  return normalizeIntelligenceLabel(value).split(' ').filter(Boolean);
}

export function lowQualityIntelligenceLabel(value) {
  const key = normalizeIntelligenceLabel(value);
  if (key.length < 3 || key.length > 100) return true;
  const tokens = intelligenceLabelTokens(value);
  if (!tokens.length || tokens.every((token) => /^\d+$/.test(token))) return true;
  if (tokens.length === 1 && (COMMON_SINGLE.has(tokens[0]) || GENERIC.has(tokens[0]) || BROAD.has(tokens[0]) || PLATFORM_TAG.has(tokens[0]))) return true;
  return tokens.every((token) => GENERIC.has(token) || BROAD.has(token) || COMMON_SINGLE.has(token) || PLATFORM_TAG.has(token) || /^\d+$/.test(token));
}

export function requiredNaturalCreators(value) {
  return intelligenceLabelTokens(value).length <= 1 ? 3 : 2;
}

export function hasEnoughNaturalSupport(value, creators, evidence) {
  const required = requiredNaturalCreators(value);
  return !lowQualityIntelligenceLabel(value) && Number(creators) >= required && Number(evidence) >= required;
}
