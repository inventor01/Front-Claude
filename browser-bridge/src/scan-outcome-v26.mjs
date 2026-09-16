const NON_FATAL_DEGRADED_STAGES = new Set(['visualUnderstanding']);

function stageIssue(name, stage = {}) {
  return `${name}: ${stage.status || 'failed'}${stage.failed ? ` (${stage.failed} failures)` : ''}${stage.errors?.length ? `: ${stage.errors.join('; ')}` : ''}`;
}

export function scanOutcome({stopped=false, evidenceCount=0, stages={}, errors=[]}) {
  if (stopped) return {status:'stopped', errors, fatalErrors:errors, warnings:[]};

  const fatalErrors=[...errors];
  const warnings=[];

  for (const [name,stage] of Object.entries(stages)) {
    if (['xDiscovery','tiktokDiscovery'].includes(name) && stage.status === 'complete' && !Number(stage.observed)) {
      fatalErrors.push(`${name}: requested discovery produced no observations`);
    }

    const failed = stage.status === 'failed';
    const degraded = stage.status === 'degraded';
    const hasItemFailures = Number(stage.failed) > 0;
    const hasStageErrors = Boolean(stage.errors?.length);
    if (!failed && !degraded && !hasItemFailures && !hasStageErrors) continue;

    const issue = stageIssue(name, stage);
    if (!failed && NON_FATAL_DEGRADED_STAGES.has(name)) warnings.push(issue);
    else fatalErrors.push(issue);
  }

  const uniqueFatal=[...new Set(fatalErrors)];
  const uniqueWarnings=[...new Set(warnings)];
  return {
    status:uniqueFatal.length?'failed':evidenceCount?'complete':'zero',
    errors:[...new Set([...uniqueFatal,...uniqueWarnings])],
    fatalErrors:uniqueFatal,
    warnings:uniqueWarnings,
  };
}
