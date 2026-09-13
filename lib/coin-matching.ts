import { normalizeLaunchName } from './live';
import { coinAliasEligible,narrativeWords,specificNarrativeTerms } from './narrative-quality';
const COMMON=new Set('the a an and or for to of in on with is are was were this that it its my your our their new official original coin token meme memecoin crypto sol solana pump fun'.split(' '));
const norm=(value:string)=>normalizeLaunchName(value).replace(/\s+/g,' ').trim();
const words=(value:string)=>norm(value).split(' ').filter((word)=>word.length>=3&&!COMMON.has(word));
function overlapScore(a:string,b:string){const left=new Set(words(a)),right=new Set(words(b));if(!left.size||!right.size)return 0;const overlap=[...left].filter((word)=>right.has(word)).length;return overlap/Math.max(1,Math.min(left.size,right.size));}
export function classifyAlias(name:string,symbol:string|null,alias:string,narrativeTitle:string){
 if(['love','grow','face','take','make','look'].includes(norm(alias)))return null;
 if(!coinAliasEligible(alias,narrativeTitle))return null;const target=norm(name),ticker=norm(symbol||''),candidate=norm(alias);if(!target||!candidate)return null;
 const aliasSpecific=specificNarrativeTerms(alias),tokenSpecific=specificNarrativeTerms(`${name} ${symbol||''}`),aliasWordCount=narrativeWords(alias).length,titleWordCount=narrativeWords(narrativeTitle).length;if(!aliasSpecific.length||!tokenSpecific.length)return null;
 // Exact means the coin explicitly names the validated narrative/alias. A
 // single first/last-name fragment cannot create an Exact hit, but a complete
 // multi-word proper name remains valid even if a surname is a common word.
 if(target===candidate||ticker===candidate){if(titleWordCount>=2&&aliasWordCount===1)return null;return{type:'exact',score:1,reason:`exact normalized ${target===candidate?'name':'symbol'} match to validated narrative phrase`};}
 const overlap=overlapScore(`${name} ${symbol||''}`,alias),containment=candidate.length>=5&&((' '+target+' ').includes(' '+candidate+' '));
 if(containment&&aliasWordCount>=2&&aliasSpecific.length>=1)return{type:'strong',score:.92,reason:'full distinctive narrative phrase contained in token name'};
 if(aliasSpecific.filter(term=>tokenSpecific.includes(term)).length>=2&&overlap>=.66)return{type:'strong',score:Number((.8+Math.min(.12,overlap*.12)).toFixed(2)),reason:'multiple distinctive narrative words match token name/symbol'};
 if(aliasSpecific.length>=1&&tokenSpecific.length>=1&&overlap>=.5&&candidate.length>=5)return{type:'possible',score:Number((.52+Math.min(.12,overlap*.12)).toFixed(2)),reason:'partial distinctive narrative wording match'};
 return null;
}
