export type LaunchWatch={id:string;name:string;created:number};
export type PumpPortalCreation={txType:'create';mint:string;name?:string;symbol?:string;[key:string]:unknown};
export const normalizeLaunchName=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const pumpFunUrl=(mint:string)=>`https://pump.fun/coin/${encodeURIComponent(mint)}`;
export const axiomUrl=(mint:string)=>`https://axiom.trade/t/${encodeURIComponent(mint)}`;
export function isPumpPortalCreation(value:unknown):value is PumpPortalCreation{if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;return v.txType==='create'&&typeof v.mint==='string'&&v.mint.length>=32&&v.mint.length<=64;}
export function matchingLaunchWatch(name:unknown,watches:LaunchWatch[]){if(typeof name!=='string')return null;const target=normalizeLaunchName(name);if(!target)return null;return watches.find(w=>normalizeLaunchName(w.name)===target)??null;}
