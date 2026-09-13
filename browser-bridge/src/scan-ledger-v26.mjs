const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export function buildScanLedgerEntry({id, finalStatus, startedAt, completedAt=Date.now(), request, latestLive, connected, contentStatus, postStatus}) {
  return {
      id, status: finalStatus, startedAt, completedAt: completedAt, durationMs: completedAt - startedAt, request,
      schemaVersion: 26, phase: latestLive.phase, phaseHistory: latestLive.phaseHistory || [], scanConnection: connected ? 'attached' : 'disconnected',
      usableEvidence: latestLive.evidence.length, inferredTopics: latestLive.candidateTopics,
      uniqueCreators: new Set(latestLive.evidence.map(row => `${row.platform}:${String(row.author || '').toLowerCase()}`)).size,
      sourceCounts: latestLive.evidence.reduce((counts, row) => { const key = row.provenance || 'unknown'; counts[key] = (counts[key] || 0) + 1; return counts; }, {}),
      contentUnderstanding: contentStatus, postUnderstanding: postStatus,
      vision: { enabled: contentStatus.enabled, provider: contentStatus.provider, model: contentStatus.model, visuallyUnderstood: latestLive.evidence.filter(row => row.contentSummary).length, scan: latestLive.stages.visualUnderstanding },
      observed: latestLive.observed, candidateTopics: latestLive.candidateTopics, platformCounts: latestLive.platformCounts,
      stages: latestLive.stages, errors: latestLive.errors, sourcePages: latestLive.sourcePages,
      samples: latestLive.evidence.slice(0, 30).map((row) => ({ platform: row.platform, author: row.author, url: row.url, mediaType: row.mediaType, contentConfidence: row.contentConfidence, views: row.views, likes: row.likes, subject: row.postSubject || null, event: row.postEvent || row.contentEvent || null, content: clean(row.contentSummary || row.content, 260), provenance: row.provenance })),
    };
}
