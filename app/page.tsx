import { requireChatGPTUser } from './chatgpt-auth';
import BrowserDashboardSync from './browser-dashboard-sync';
import BrowserIntelligence from './browser-intelligence';
import Desk from './desk';
import FrontLiveTools from './front-live-tools';

export default async function Home() {
  await requireChatGPTUser('/');
  return <><Desk/><BrowserIntelligence/><BrowserDashboardSync/><FrontLiveTools/></>;
}
