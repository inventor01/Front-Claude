import { requireChatGPTUser } from './chatgpt-auth';
import FrontDesk from './front-desk';

export default async function Home() {
  await requireChatGPTUser('/');
  return <FrontDesk/>;
}
