import { requireChatGPTUser } from './chatgpt-auth';
import BrowserIntelligence from './browser-intelligence';
import DiscoveryDashboard from './discovery-dashboard';
import FrontLiveTools from './front-live-tools';
import RadarManager from './radar-manager';

export default async function Home() {
  await requireChatGPTUser('/');
  return <><DiscoveryDashboard/><BrowserIntelligence/><FrontLiveTools/><RadarManager/></>;
}
