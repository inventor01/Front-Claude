export type PumpPortalRuntimeState={enabled:boolean;status:string;connected:boolean};
export type PumpPortalWireEvent={txType?:string;mint?:string;name?:string;symbol?:string};
export const PUMPPORTAL_ENABLE_KEY:string;
export function ensurePumpPortalRuntime():PumpPortalRuntimeState;
export function setPumpPortalRuntimeEnabled(enabled:boolean):PumpPortalRuntimeState;
export function subscribePumpPortalRuntime(listener:(state:PumpPortalRuntimeState)=>void):()=>void;
export function subscribePumpPortalMessages(listener:(event:PumpPortalWireEvent)=>void):()=>void;
export function getPumpPortalRuntimeSnapshot():PumpPortalRuntimeState;
