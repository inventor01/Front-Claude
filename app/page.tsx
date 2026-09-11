import { requireChatGPTUser } from './chatgpt-auth';
import Desk from './desk';
import FrontLiveTools from './front-live-tools';
export default async function Home(){await requireChatGPTUser('/');return <><Desk/><FrontLiveTools/></>;}
