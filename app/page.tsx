import { requireChatGPTUser } from './chatgpt-auth';
import Desk from './desk';
export default async function Home(){await requireChatGPTUser('/');return <Desk/>;}
