import { requireChatGPTUser } from './chatgpt-auth';
import BrowserDashboardSync from './browser-dashboard-sync';
import BrowserIntelligence from './browser-intelligence';
import Desk from './desk';
import FrontLiveTools from './front-live-tools';
import NarrativeCreationWatcher from './narrative-creation-watcher';
import PublicSignalsPanel from './public-signals-panel';
import RadarManager from './radar-manager';

export default async function Home() {
  await requireChatGPTUser('/');
  return <><Desk/><PublicSignalsPanel/><BrowserIntelligence/><BrowserDashboardSync/><NarrativeCreationWatcher/><FrontLiveTools/><RadarManager/></>;
}
