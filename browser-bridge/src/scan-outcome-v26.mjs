export function scanOutcome({stopped=false, evidenceCount=0, stages={}, errors=[]}) {
  if (stopped) return {status:'stopped', errors};
  const allErrors=[...errors];
  for (const [name,stage] of Object.entries(stages)) {
    if (['xDiscovery','tiktokDiscovery'].includes(name) && stage.status === 'complete' && !Number(stage.observed)) allErrors.push(`${name}: requested discovery produced no observations`);
    if (['failed','degraded'].includes(stage.status) || Number(stage.failed)>0 || stage.errors?.length) {
      allErrors.push(`${name}: ${stage.status || 'failed'}${stage.failed ? ` (${stage.failed} failures)` : ''}${stage.errors?.length ? `: ${stage.errors.join('; ')}` : ''}`);
    }
  }
  return {status:allErrors.length?'failed':evidenceCount?'complete':'zero',errors:[...new Set(allErrors)]};
}
