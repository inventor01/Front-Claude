const RAW_NOISE = `
original originals originalsound official officially create creates created creating creation creations creator creators
sound sounds audio caption captions video videos photo photos image images post posts repost reposts reply replies comment comments
share shares view views like likes follow follows part parts episode episodes full live new latest today tonight yesterday tomorrow
update updates breaking news meme memes viral virality trend trends trending funny reaction reactions clip clips edit edits account accounts
user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone anybody everyone everybody
thing things stuff something anything everything name names word words topic topics story stories love hate trade trading buy buying sell selling
market markets coin coins token tokens crypto solana tiktok twitter x fyp foryou ever solo human back
sonido sonidos original originales audio vídeo video videos foto fotos publicación publicaciones compartir comparte compartido vista vistas me gusta
esta este esto hacer hace haciendo hecho haber escucha escuchar escuchando canción cancion canciones música musica parte partes nuevo nueva nuevos nuevas hoy ayer mañana
звук звуки оригинальный оригинальная оригинальное оригинальные оригинал видео фото пост посты тренд тренды вирусный
som sons original originais vídeo video vídeos videos foto fotos postagem postagens compartilhar curtida curtidas hoje ontem amanhã
son sons original originale originaux vidéo video vidéos videos tendance tendances
originalton sound sounds video videos trend trends
`.trim();

const RAW_STOP = `
the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your
we our they their he she his her not no yes just very really now have has had do does did can could would should will may might about into over
under after before more most some any all one two via amp rt get got like know think make made going go went see saw says said say look looks
looking why how what when where who which there here want wants wanted thats that s im ive dont cant wont isnt arent
el la los las un una unos unas y o pero si de del en por para con sin es son era eran ser fue fueron se su sus mi mis tu tus que como cuando donde
quien quienes hay aqui allí ya muy más mas menos todo todos toda todas uno dos
`.trim();

export const NARRATIVE_NOISE = new Set(RAW_NOISE.split(/\s+/).filter(Boolean));
export const NARRATIVE_STOP = new Set(RAW_STOP.split(/\s+/).filter(Boolean));

const BOILERPLATE = new Set([
  'original sound','sound original','sonido original','audio original','som original','son original','originalton',
  'оригинальный звук','оригинальная музыка','original audio','original video','sonido oficial','official sound',
]);

const GENERIC_STEM = /^(?:creat(?:e|es|ed|ing|ion|ions|or|ors)|origin(?:al|als|ally)?|sound(?:s)?|audio|video(?:s)?|post(?:s)?|trend(?:s|ing)?|viral|meme(?:s)?|reaction(?:s)?|clip(?:s)?|update(?:s)?|share(?:s|d|ing)?|view(?:s|ed|ing)?|like(?:s|d|ing)?|follow(?:s|ed|ing)?|sonid(?:o|os)|escuch(?:a|ar|ando)|canci[oó]n(?:es)?|звук(?:и)?|оригинальн(?:ый|ая|ое|ые)|som(?:s)?|tend(?:ance|ances))$/iu;

export function normalizeNarrativeText(value:string){
  return String(value??'').normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/^#/,'').replace(/[_-]+/g,' ').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
}

export function narrativeWords(value:string){return normalizeNarrativeText(value).split(' ').filter(Boolean);}
export function specificNarrativeTerms(value:string){return narrativeWords(value).filter((word)=>word.length>=3&&!NARRATIVE_STOP.has(word)&&!NARRATIVE_NOISE.has(word)&&!GENERIC_STEM.test(word)&&!/^\d+$/.test(word));}

export function isNarrativeLabelJunk(value:string){
  const normalized=normalizeNarrativeText(value);const words=narrativeWords(value);if(!normalized||!words.length)return true;
  if(BOILERPLATE.has(normalized))return true;
  if(words.length===1){const word=words[0];return word.length<4||NARRATIVE_STOP.has(word)||NARRATIVE_NOISE.has(word)||GENERIC_STEM.test(word)||/^\d+$/.test(word);}
  const specific=specificNarrativeTerms(value);if(!specific.length)return true;
  const noiseCount=words.filter((word)=>NARRATIVE_STOP.has(word)||NARRATIVE_NOISE.has(word)||GENERIC_STEM.test(word)||word.length<3).length;
  if(words.length>=3&&specific.length===1&&noiseCount>=words.length-1)return true;
  return false;
}

function rowTerms(value:string){return new Set(specificNarrativeTerms(value));}
function creatorKey(row:{platform?:string;author?:string}){return `${row.platform||''}:${String(row.author||'').toLowerCase()}`;}

export function semanticCrossPlatformEvidence(rows:Array<{platform:string;author:string;content:string}>,title:string){
  const x=rows.filter((row)=>row.platform==='X').slice(0,60),t=rows.filter((row)=>row.platform==='TikTok').slice(0,60);
  const titleTerms=specificNarrativeTerms(title);const creators=new Set<string>();let pairs=0;
  for(const left of x)for(const right of t){
    if(creatorKey(left)===creatorKey(right))continue;
    const lt=rowTerms(left.content),rt=rowTerms(right.content);if(!lt.size||!rt.size)continue;
    const titleInBoth=titleTerms.length>=2&&titleTerms.every((term)=>lt.has(term)&&rt.has(term));
    const shared=[...lt].filter((term)=>rt.has(term));const overlap=shared.length/Math.max(1,Math.min(lt.size,rt.size));
    const oneWordContext=titleTerms.length===1&&lt.has(titleTerms[0])&&rt.has(titleTerms[0])&&shared.some((term)=>term!==titleTerms[0]);
    if(!titleInBoth&&!oneWordContext&&!(shared.length>=2&&overlap>=.5))continue;
    pairs++;creators.add(creatorKey(left));creators.add(creatorKey(right));
  }
  return{pairs,creators:creators.size,corroborated:pairs>0&&creators.size>=2};
}

export function narrativeLabelContains(a:string,b:string){
  const left=specificNarrativeTerms(a),right=specificNarrativeTerms(b);if(!left.length||!right.length)return false;
  const small=left.length<=right.length?left:right,big=left.length<=right.length?right:left;
  return small.length<big.length&&small.every((term)=>big.includes(term));
}

export function coinAliasEligible(alias:string,narrativeTitle:string){
  if(isNarrativeLabelJunk(alias))return false;
  const aliasTerms=specificNarrativeTerms(alias),titleTerms=specificNarrativeTerms(narrativeTitle);if(!aliasTerms.length)return false;
  if(titleTerms.length>=2&&aliasTerms.length===1&&titleTerms.includes(aliasTerms[0])&&normalizeNarrativeText(alias)!==normalizeNarrativeText(narrativeTitle))return false;
  return aliasTerms.length>=2||aliasTerms[0].length>=4;
}
