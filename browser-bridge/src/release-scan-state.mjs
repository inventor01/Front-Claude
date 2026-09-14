// Transport failure is not evidence failure. Only use snapshots for this scan.
export function releaseScanState({scan, live, health, ledger, scanId, timedOut = false, transportError} = {}) {
  const matchingLive = live?.scanId === scanId ? live : null;
  const entry = ledger?.scans?.find(row => row.id === scanId);
  const response = scan?.body?.scanId === scanId ? scan.body : null;
  const evidence = Array.isArray(response?.evidence) ? response.evidence : matchingLive?.evidence;
  const counts = evidence ? {evidence:evidence.length, x:evidence.filter(r=>r.platform==='X').length, tiktok:evidence.filter(r=>r.platform==='TikTok').length} : entry ? {evidence:entry.usableEvidence ?? entry.observed, x:entry.platformCounts?.X ?? 0, tiktok:entry.platformCounts?.TikTok ?? 0} : {evidence:null,x:null,tiktok:null};
  const running = matchingLive?.active === true || (health?.running && health.scanId === scanId);
  const status = matchingLive?.status || entry?.status;
  const outcome = scan?.res?.status === 499 ? 'validator-aborted' : timedOut ? 'validator-timeout' : transportError ? 'transport-failure' : running ? 'scan-running' : status === 'failed' ? 'scan-failed-internally' : counts.evidence === 0 ? 'scan-zero-evidence' : status || 'unknown';
  return {outcome,running,status,counts,evidence:evidence || [], evidenceAvailable:Boolean(evidence), live:matchingLive,ledger:entry,transportError:transportError || null};
}
