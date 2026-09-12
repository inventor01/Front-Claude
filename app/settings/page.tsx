import {requireChatGPTUser} from '../chatgpt-auth';
import SettingsClient from './settings-client';

export default async function SettingsPage(){
  await requireChatGPTUser('/settings');
  return <SettingsClient/>;
}
