import {requireChatGPTUser} from '../../chatgpt-auth';
import LedgerClient from './ledger-client';

export default async function ScanLedgerPage(){
  await requireChatGPTUser('/settings/ledger');
  return <LedgerClient/>;
}
