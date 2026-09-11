import { requireChatGPTUser } from '../chatgpt-auth';
import BrowserIntelligence from '../browser-intelligence';
import FrontLiveTools from '../front-live-tools';

export default async function SettingsPage(){
  await requireChatGPTUser('/settings');
  return <><BrowserIntelligence/><FrontLiveTools/></>;
}
