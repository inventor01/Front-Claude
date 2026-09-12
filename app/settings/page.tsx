import {requireChatGPTUser} from '../chatgpt-auth';
import SettingsClient from './settings-client';

export default async function SettingsPage(){
  await requireChatGPTUser('/settings');
  return <>
    <SettingsClient/>
    <a href="/settings/ledger" style={{position:'fixed',right:20,bottom:20,zIndex:40,border:'1px solid #5a4a14',background:'#f7c948',color:'#17120a',borderRadius:12,padding:'11px 14px',fontSize:12,fontWeight:800,textDecoration:'none',boxShadow:'0 8px 30px rgba(0,0,0,.35)'}}>Open scan ledger</a>
  </>;
}
