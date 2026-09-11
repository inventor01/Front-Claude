import { requireChatGPTUser } from './chatgpt-auth';
import BrowserIntelligence from './browser-intelligence';
import Desk from './desk';
import DiscoveryDashboard from './discovery-dashboard';
import FrontLiveTools from './front-live-tools';
import NarrativeCreationWatcher from './narrative-creation-watcher';
import RadarManager from './radar-manager';

export default async function Home() {
  await requireChatGPTUser('/');
  return <><DiscoveryDashboard/><Desk/><BrowserIntelligence/><NarrativeCreationWatcher/><FrontLiveTools/><RadarManager/></>;
}
