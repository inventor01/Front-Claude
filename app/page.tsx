import { requireChatGPTUser } from './chatgpt-auth';
import FrontLiveShell from './front-live-shell';

export default async function Home() {
  await requireChatGPTUser('/');
  return <FrontLiveShell/>;
}
