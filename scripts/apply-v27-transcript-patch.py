from pathlib import Path


def replace_once(file, old, new):
    path = Path(file)
    source = path.read_text()
    if old not in source:
        raise RuntimeError(f"Patch anchor not found in {file}: {old[:100]!r}")
    path.write_text(source.replace(old, new, 1))


def append_once(file, marker, text):
    path = Path(file)
    source = path.read_text()
    if marker not in source:
        path.write_text(source + text)


server = "browser-bridge/src/server-v25.mjs"
replace_once(server,
r'''import { PostUnderstandingEngineV26 } from './post-understanding-v26.mjs';
import { enhanceNarrativesV26 } from './narrative-intelligence-v26.mjs';''',
r'''import { PostUnderstandingEngineV26 } from './post-understanding-v26.mjs';
import { VideoTranscriptEngineV27, isVideoRow, transcriptTerminal } from './video-transcript-v27.mjs';
import { VideoMeaningEngineV27 } from './video-meaning-v27.mjs';
import { enhanceNarrativesV26 } from './narrative-intelligence-v26.mjs';''')

replace_once(server,
r'''const understanding = new ContentUnderstandingEngine({ dataDir: DATA_DIR });
const postUnderstanding = new PostUnderstandingEngineV26({ dataDir: DATA_DIR });
const tiktok = new BroadTikTokObserver''',
r'''const understanding = new ContentUnderstandingEngine({ dataDir: DATA_DIR });
const postUnderstanding = new PostUnderstandingEngineV26({ dataDir: DATA_DIR });
const transcription = new VideoTranscriptEngineV27({ dataDir: DATA_DIR });
const videoMeaning = new VideoMeaningEngineV27({ dataDir: DATA_DIR });
const tiktok = new BroadTikTokObserver''')

replace_once(server,
r'''async function contextualizePosts(rows, phaseName = 'post-understanding') {''',
r'''function publishAnalyzedRow(row) {
  const currentRows = Array.isArray(latestLive.evidence) ? latestLive.evidence : [];
  const index = currentRows.findIndex((item) => item?.id === row?.id);
  const evidence = index >= 0
    ? currentRows.map((item, i) => i === index ? row : item)
    : [...currentRows, row].slice(-300);
  latestLive = { ...latestLive, evidence, updatedAt: Date.now() };
}
async function transcribeAllVideos(rows, phaseName = 'transcription') {
  if (!rows.length || shouldStop()) return rows;
  setPhase(phaseName);
  const priorRuns = latestLive.stages.transcription?.runs || [];
  const requested = rows.filter(isVideoRow).length;
  stage('transcription', { status: 'running', requested, runs: priorRuns, engine: transcription.status() });
  const context = await ensureContext();
  const enriched = await transcription.enrich(context, rows, {
    onRow: async (row, progress) => {
      publishAnalyzedRow(row);
      stage('transcription', { status: 'running', requested, progress, engine: transcription.status() });
    },
  });
  const runs = [...priorRuns, { phase: phaseName, ...enriched.stats }];
  const sum = (key) => runs.reduce((total, run) => total + Number(run[key] || 0), 0);
  const totals = Object.fromEntries(['requested','completed','captioned','transcribed','noSpeech','cached','failed','unavailable'].map((key) => [key, sum(key)]));
  const errors = [...new Set(runs.flatMap((run) => run.errors || []))].slice(0, 20);
  stage('transcription', { ...totals, runs, errors, status: totals.failed || totals.unavailable ? 'degraded' : 'complete', engine: transcription.status() });
  latestLive = { ...latestLive, evidence: enriched.rows.slice(-300), updatedAt: Date.now() };
  return enriched.rows;
}
async function understandAllVideos(rows, phaseName = 'video-meaning') {
  if (!rows.length || shouldStop()) return rows;
  setPhase(phaseName);
  const priorRuns = latestLive.stages.videoMeaning?.runs || [];
  const requested = rows.filter(isVideoRow).length;
  stage('videoMeaning', { status: 'running', requested, runs: priorRuns, engine: videoMeaning.status() });
  const context = await ensureContext();
  const enriched = await videoMeaning.enrich(context, rows, {
    onRow: async (row, progress) => {
      publishAnalyzedRow(row);
      stage('videoMeaning', { status: 'running', requested, progress, engine: videoMeaning.status() });
    },
  });
  const runs = [...priorRuns, { phase: phaseName, ...enriched.stats }];
  const sum = (key) => runs.reduce((total, run) => total + Number(run[key] || 0), 0);
  const totals = Object.fromEntries(['requested','completed','modeled','visualFallback','cached','failed'].map((key) => [key, sum(key)]));
  const errors = [...new Set(runs.flatMap((run) => run.errors || []))].slice(0, 20);
  stage('videoMeaning', { ...totals, runs, errors, status: totals.failed ? 'degraded' : 'complete', engine: videoMeaning.status() });
  latestLive = { ...latestLive, evidence: enriched.rows.slice(-300), updatedAt: Date.now() };
  return enriched.rows;
}

async function contextualizePosts(rows, phaseName = 'post-understanding') {''')

replace_once(server,
r'''      tiktokDiscovery: { status: request.scanTikTokForYou ? 'pending' : 'disabled', active: request.scanTikTokForYou, observed: 0, grounded: 0, target: request.targetUniqueFeedItems, sourcePages: [], errors: [], updatedAt: Date.now() },
      visualUnderstanding: { status: 'pending', updatedAt: Date.now() },''',
r'''      tiktokDiscovery: { status: request.scanTikTokForYou ? 'pending' : 'disabled', active: request.scanTikTokForYou, observed: 0, grounded: 0, target: request.targetUniqueFeedItems, sourcePages: [], errors: [], updatedAt: Date.now() },
      transcription: { status: 'pending', updatedAt: Date.now() },
      visualUnderstanding: { status: 'pending', updatedAt: Date.now() },
      videoMeaning: { status: 'pending', updatedAt: Date.now() },''')

replace_once(server,
r'''    setPhase('visual-understanding');
    const context = await ensureContext();''',
r'''    resultRows = await transcribeAllVideos(resultRows);

    setPhase('visual-understanding');
    const context = await ensureContext();''')

replace_once(server,
r'''    } else {
      stage('visualUnderstanding', { status: understanding.status().enabled ? (shouldStop() ? 'stopped' : 'skipped-no-video') : 'inactive', engine: understanding.status() });
    }

    resultRows = await contextualizePosts(resultRows);''',
r'''    } else {
      stage('visualUnderstanding', { status: understanding.status().enabled ? (shouldStop() ? 'stopped' : 'skipped-no-video') : 'inactive', engine: understanding.status() });
    }

    resultRows = await understandAllVideos(resultRows);
    resultRows = await contextualizePosts(resultRows);''')

replace_once(server,
r'''    if (!shouldStop() && newOrigin.length) {
      const enrichedOrigin = await contextualizePosts(newOrigin, 'post-understanding-origin');
      const byId = new Map(enrichedOrigin.map(row => [row.id, row]));
      resultRows = resultRows.map(row => byId.get(row.id) || row);
      topics = deriveTopics(resultRows, 24);''',
r'''    if (!shouldStop() && newOrigin.length) {
      let analyzedOrigin = await transcribeAllVideos(newOrigin, 'transcription-origin');
      analyzedOrigin = await understandAllVideos(analyzedOrigin, 'video-meaning-origin');
      const enrichedOrigin = await contextualizePosts(analyzedOrigin, 'post-understanding-origin');
      const byId = new Map(enrichedOrigin.map(row => [row.id, row]));
      resultRows = resultRows.map(row => byId.get(row.id) || row);
      topics = deriveTopics(resultRows, 24);''')

replace_once(server,
r'''      contentUnderstanding: { ...understanding.status(), visuallyUnderstood: resultRows.filter((row) => row.contentSummary).length },
      postUnderstanding: postUnderstanding.status(), at: Date.now(),''',
r'''      transcription: { ...transcription.status(), terminalVideos: resultRows.filter((row) => isVideoRow(row) && transcriptTerminal(row.transcriptStatus)).length },
      contentUnderstanding: { ...understanding.status(), visuallyUnderstood: resultRows.filter((row) => row.contentSummary).length },
      videoMeaning: { ...videoMeaning.status(), understoodVideos: resultRows.filter((row) => isVideoRow(row) && row.videoAbout).length },
      postUnderstanding: postUnderstanding.status(), at: Date.now(),''')

replace_once(server,
r'''    contentUnderstanding: understanding.status(), postUnderstanding: postUnderstanding.status(),
    contentTargets: { deepVideos: Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 2), scoutVideos: Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 1), contextualPosts: Number(process.env.FRONT_CONTEXT_MAX_POSTS || 12) },''',
r'''    transcription: transcription.status(), contentUnderstanding: understanding.status(), videoMeaning: videoMeaning.status(), postUnderstanding: postUnderstanding.status(),
    contentTargets: { transcriptConcurrency: Number(process.env.FRONT_TRANSCRIPT_CONCURRENCY || 2), deepVideos: Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 2), scoutVideos: Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 1), contextualPosts: Number(process.env.FRONT_CONTEXT_MAX_POSTS || 12) },''')

replace_once(server,
"'broad-tiktok-observation','caption-light-tiktok-discovery','visual-understanding','contextual-post-understanding'",
"'broad-tiktok-observation','caption-light-tiktok-discovery','all-video-transcription','local-whisper-asr','all-video-meaning','visual-understanding','contextual-post-understanding'")

visual = "browser-bridge/src/content-understanding.mjs"
replace_once(visual,
r'''    capture.transcript ? `Available caption track text: ${capture.transcript}` : 'Available caption track text: none',''',
r'''    row.transcript ? `Generated spoken transcript (${clean(row.transcriptSource, 80) || 'unknown source'}): ${clean(row.transcript, 3200)}` : 'Generated spoken transcript: none',
    capture.transcript ? `Available caption track text: ${capture.transcript}` : 'Available caption track text: none',''')

start = "browser-bridge/start.command"
replace_once(start,
r'''export FRONT_CONTEXT_NUM_PREDICT="${FRONT_CONTEXT_NUM_PREDICT:-900}"
export FRONT_TIKTOK_OBSERVER_MS="${FRONT_TIKTOK_OBSERVER_MS:-850}"''',
r'''export FRONT_CONTEXT_NUM_PREDICT="${FRONT_CONTEXT_NUM_PREDICT:-900}"
export FRONT_TRANSCRIPT_CONCURRENCY="${FRONT_TRANSCRIPT_CONCURRENCY:-2}"
export FRONT_TRANSCRIPT_TIMEOUT_MS="${FRONT_TRANSCRIPT_TIMEOUT_MS:-180000}"
export FRONT_VIDEO_MEANING_BATCH_SIZE="${FRONT_VIDEO_MEANING_BATCH_SIZE:-4}"
export FRONT_VIDEO_MEANING_TIMEOUT_MS="${FRONT_VIDEO_MEANING_TIMEOUT_MS:-60000}"
export FRONT_TIKTOK_OBSERVER_MS="${FRONT_TIKTOK_OBSERVER_MS:-850}"''')
replace_once(start,
'echo "v26 preserves the v25 single-process collectors and adds contextual post understanding plus semantic narrative clustering."',
'echo "v27 preserves the v26 single-process collectors and adds exhaustive video transcription + per-video meaning before narrative clustering."')
replace_once(start,
r'''echo "Balanced profile: vision=${FRONT_OLLAMA_MODEL:-none}, context=${FRONT_CONTEXT_OLLAMA_MODEL:-none}, deep=$FRONT_CONTENT_DEEP_VIDEOS, scout=$FRONT_CONTENT_SCOUT_VIDEOS, background=$FRONT_CONTENT_BACKGROUND_VIDEOS, model-frames=$FRONT_CONTENT_MODEL_FRAMES, vision-timeout=${FRONT_CONTENT_TIMEOUT_MS}ms, contextual=$FRONT_CONTEXT_MAX_POSTS, context-batch=$FRONT_CONTEXT_BATCH_SIZE, context-timeout=${FRONT_CONTEXT_TIMEOUT_MS}ms, keep-alive=${FRONT_OLLAMA_KEEP_ALIVE}, TikTok poll=${FRONT_TIKTOK_OBSERVER_MS}ms."''',
r'''echo "Balanced profile: transcript-concurrency=${FRONT_TRANSCRIPT_CONCURRENCY}, transcript-timeout=${FRONT_TRANSCRIPT_TIMEOUT_MS}ms, video-meaning-batch=${FRONT_VIDEO_MEANING_BATCH_SIZE}, vision=${FRONT_OLLAMA_MODEL:-none}, context=${FRONT_CONTEXT_OLLAMA_MODEL:-none}, deep=$FRONT_CONTENT_DEEP_VIDEOS, scout=$FRONT_CONTENT_SCOUT_VIDEOS, background=$FRONT_CONTENT_BACKGROUND_VIDEOS, model-frames=$FRONT_CONTENT_MODEL_FRAMES, vision-timeout=${FRONT_CONTENT_TIMEOUT_MS}ms, contextual=$FRONT_CONTEXT_MAX_POSTS, context-batch=$FRONT_CONTEXT_BATCH_SIZE, context-timeout=${FRONT_CONTEXT_TIMEOUT_MS}ms, keep-alive=${FRONT_OLLAMA_KEEP_ALIVE}, TikTok poll=${FRONT_TIKTOK_OBSERVER_MS}ms."''')
replace_once(start,
r'''if [ -n "${FRONT_CONTENT_API_KEY:-${OPENAI_API_KEY:-}}" ]; then''',
r'''if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v whisper-cli >/dev/null 2>&1 || [ ! -s "${FRONT_WHISPER_MODEL:-$FRONT_DATA_DIR/models/ggml-base.bin}" ]; then
  echo "WARNING: full video speech-to-text is not ready. Run: bash ./setup-transcription.command"
else
  echo "Video transcription: local whisper.cpp ready for every collected X/TikTok video."
fi
if [ -n "${FRONT_CONTENT_API_KEY:-${OPENAI_API_KEY:-}}" ]; then''')

validator = "browser-bridge/scripts/validate-v26-release.mjs"
replace_once(validator,
r'''  check('Visual understanding configured', health?.contentUnderstanding?.enabled === true, `${health?.contentUnderstanding?.provider || 'off'} · ${health?.contentUnderstanding?.model || ''}`);
  check('Post understanding configured', health?.postUnderstanding?.enabled === true, `${health?.postUnderstanding?.provider || 'off'} · ${health?.postUnderstanding?.model || ''}`);''',
r'''  check('Full local video transcription configured', health?.transcription?.fullSpeechToText === true, `whisper=${health?.transcription?.whisperReady ? 'ready' : 'missing'} · ffmpeg=${health?.transcription?.ffmpegReady ? 'ready' : 'missing'} · model=${health?.transcription?.modelReady ? 'ready' : 'missing'}`);
  check('Visual understanding configured', health?.contentUnderstanding?.enabled === true, `${health?.contentUnderstanding?.provider || 'off'} · ${health?.contentUnderstanding?.model || ''}`);
  check('All-video meaning configured', health?.videoMeaning?.enabled === true, `${health?.videoMeaning?.provider || 'off'} · ${health?.videoMeaning?.model || ''}`);
  check('Post understanding configured', health?.postUnderstanding?.enabled === true, `${health?.postUnderstanding?.provider || 'off'} · ${health?.postUnderstanding?.model || ''}`);''')
replace_once(validator,
r'''  const vision = stages.visualUnderstanding || {};
  const post = stages.postUnderstanding || {};''',
r'''  const transcript = stages.transcription || {};
  const vision = stages.visualUnderstanding || {};
  const meaning = stages.videoMeaning || {};
  const post = stages.postUnderstanding || {};''')
replace_once(validator,
r'''  check('Visual understanding complete', vision.status === 'complete', `${vision.status || 'missing'} requested=${n(vision.requested)} enriched=${n(vision.enriched)} cached=${n(vision.cached)} failed=${n(vision.failed)}`);''',
r'''  check('Every-video transcription stage complete', transcript.status === 'complete', `${transcript.status || 'missing'} requested=${n(transcript.requested)} completed=${n(transcript.completed)} failed=${n(transcript.failed)} unavailable=${n(transcript.unavailable)}`);
  check('Every collected video reached a transcript terminal state', n(transcript.requested) > 0 && n(transcript.completed) === n(transcript.requested), `completed=${n(transcript.completed)}/${n(transcript.requested)}`);
  check('Transcription has zero failures/unavailable videos', n(transcript.failed) === 0 && n(transcript.unavailable) === 0, `failed=${n(transcript.failed)}, unavailable=${n(transcript.unavailable)}`);
  check('Visual understanding complete', vision.status === 'complete', `${vision.status || 'missing'} requested=${n(vision.requested)} enriched=${n(vision.enriched)} cached=${n(vision.cached)} failed=${n(vision.failed)}`);''')
replace_once(validator,
r'''  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';
  check('Post understanding complete' ''',
r'''  check('Every-video meaning stage complete', meaning.status === 'complete', `${meaning.status || 'missing'} requested=${n(meaning.requested)} completed=${n(meaning.completed)} failed=${n(meaning.failed)}`);
  check('Every collected video received semantic meaning', n(meaning.requested) > 0 && n(meaning.completed) === n(meaning.requested) && n(meaning.failed) === 0, `completed=${n(meaning.completed)}/${n(meaning.requested)}, failed=${n(meaning.failed)}`);
  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';
  check('Post understanding complete' ''')
replace_once(validator,
r'''  check('No duplicate platform+URL rows', duplicates(evidence) === 0, `${duplicates(evidence)} duplicate(s)`);''',
r'''  const videoRows = evidence.filter((row) => row?.platform === 'TikTok' || /video/i.test(String(row?.mediaType || '')));
  check('Every final video exposes transcript status', videoRows.length > 0 && videoRows.every((row) => ['captioned','transcribed','no-speech'].includes(String(row.transcriptStatus || ''))), `${videoRows.filter((row) => !['captioned','transcribed','no-speech'].includes(String(row.transcriptStatus || ''))).length} incomplete / ${videoRows.length}`);
  check('Every final video has a concrete meaning', videoRows.length > 0 && videoRows.every((row) => Boolean(String(row.videoAbout || '').trim()) && n(row.videoMeaningConfidence) >= .4), `${videoRows.filter((row) => !String(row.videoAbout || '').trim() || n(row.videoMeaningConfidence) < .4).length} missing/weak / ${videoRows.length}`);
  check('No duplicate platform+URL rows', duplicates(evidence) === 0, `${duplicates(evidence)} duplicate(s)`);''')
replace_once(validator,
r'''  check('Visual-understanding phase observed', phases.has('visual-understanding'), [...phases].join(' → '));''',
r'''  check('Transcription phase observed', phases.has('transcription'), [...phases].join(' → '));
  check('Visual-understanding phase observed', phases.has('visual-understanding'), [...phases].join(' → '));
  check('Video-meaning phase observed', phases.has('video-meaning'), [...phases].join(' → '));''')

shell = "app/front-live-shell.tsx"
replace_once(shell,
r'''  provenance:string;
  semanticNarrativeKey?:string|null;''',
r'''  provenance:string;
  mediaType?:string|null;
  transcript?:string|null;
  transcriptSource?:string|null;
  transcriptStatus?:string|null;
  videoAbout?:string|null;
  videoSubject?:string|null;
  videoEvent?:string|null;
  videoMeaningConfidence?:number|null;
  videoMeaningStatus?:string|null;
  semanticNarrativeKey?:string|null;''')
replace_once(shell,
r'''        const fresh=(next.evidence||[]).filter((row)=>row?.id&&!syncedIds.current.has(row.id)).slice(0,120);''',
r'''        const ready=(next.evidence||[]).filter((row)=>{const video=row.platform==='TikTok'||/video/i.test(String(row.mediaType||''));return !video||(['captioned','transcribed','no-speech'].includes(String(row.transcriptStatus||''))&&row.videoMeaningStatus==='modeled');});
        const fresh=ready.filter((row)=>row?.id&&!syncedIds.current.has(row.id)).slice(0,120);''')
replace_once(shell,
r'''          <p>{row.content}</p>
          <small>{[ago(row.published),row.views!=null?`${compact(row.views)} views`:null,row.likes!=null?`${compact(row.likes)} likes`:null].filter(Boolean).join(' · ')}</small>''',
r'''          {row.videoAbout&&<div className={styles.videoAbout}><b>Video</b><span>{row.videoAbout}</span></div>}
          <p>{row.content}</p>
          {row.transcript&&<div className={styles.transcript}><b>Transcript · {row.transcriptSource||'speech'}</b><span>{row.transcript.slice(0,520)}{row.transcript.length>520?'…':''}</span></div>}
          <small>{[ago(row.published),row.views!=null?`${compact(row.views)} views`:null,row.likes!=null?`${compact(row.likes)} likes`:null,row.transcriptStatus?`speech ${row.transcriptStatus}`:null].filter(Boolean).join(' · ')}</small>''')

css = "app/front-live-shell.module.css"
replace_once(css,
'.evidenceCard small{display:block;color:#7f8a9a;font-size:9px;}',
'''.evidenceCard small{display:block;color:#7f8a9a;font-size:9px;}
.videoAbout,.transcript{margin:6px 0;padding:7px 8px;border-radius:8px;background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.14);display:flex;flex-direction:column;gap:3px;}
.videoAbout b,.transcript b{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#93c5fd;}
.videoAbout span,.transcript span{font-size:10px;line-height:1.4;color:#cbd5e1;}
.transcript{background:rgba(255,255,255,.025);border-color:rgba(148,163,184,.12);}
.transcript b{color:#94a3b8;}''')

rich = "app/api/browser-rich/route.ts"
replace_once(rich,
r''' id?:unknown;platform?:unknown;provenance?:unknown;replies?:unknown;reposts?:unknown;bookmarks?:unknown;quotes?:unknown;comments?:unknown;shares?:unknown;saves?:unknown;soundId?:unknown;soundTitle?:unknown;soundAuthor?:unknown;mediaType?:unknown;quotedUrl?:unknown;coverUrl?:unknown;hashtags?:unknown;creatorFollowers?:unknown;outboundUrls?:unknown;relationType?:unknown;relatedVideoId?:unknown;visualHash?:unknown;''',
r''' id?:unknown;platform?:unknown;provenance?:unknown;replies?:unknown;reposts?:unknown;bookmarks?:unknown;quotes?:unknown;comments?:unknown;shares?:unknown;saves?:unknown;soundId?:unknown;soundTitle?:unknown;soundAuthor?:unknown;mediaType?:unknown;quotedUrl?:unknown;coverUrl?:unknown;hashtags?:unknown;creatorFollowers?:unknown;outboundUrls?:unknown;relationType?:unknown;relatedVideoId?:unknown;visualHash?:unknown;transcript?:unknown;transcriptSource?:unknown;transcriptStatus?:unknown;transcriptDuration?:unknown;videoAbout?:unknown;videoSubject?:unknown;videoEvent?:unknown;videoMeaningConfidence?:unknown;videoMeaningMethod?:unknown;videoMeaningStatus?:unknown;''')
replace_once(rich,
r'''   evidenceStatements.push(db().prepare(`INSERT INTO evidence_rich(owner,id,observed,replies,reposts,bookmarks,quotes,comments,shares,saves,sound_id,sound_title,sound_author,media_type,quoted_url,cover_url,hashtags,feed_surface,creator_followers,outbound_urls,relation_type,related_video_id,visual_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,id,observed) DO UPDATE SET replies=excluded.replies,reposts=excluded.reposts,bookmarks=excluded.bookmarks,quotes=excluded.quotes,comments=excluded.comments,shares=excluded.shares,saves=excluded.saves,sound_id=excluded.sound_id,sound_title=excluded.sound_title,sound_author=excluded.sound_author,media_type=excluded.media_type,quoted_url=excluded.quoted_url,cover_url=excluded.cover_url,hashtags=excluded.hashtags,feed_surface=excluded.feed_surface,creator_followers=excluded.creator_followers,outbound_urls=excluded.outbound_urls,relation_type=excluded.relation_type,related_video_id=excluded.related_video_id,visual_hash=excluded.visual_hash`)
    .bind(user.userId,id,observed,metric(item.replies),metric(item.reposts),metric(item.bookmarks),metric(item.quotes),metric(item.comments),metric(item.shares),metric(item.saves),clean(item.soundId,120)||null,clean(item.soundTitle,240)||null,clean(item.soundAuthor,160)||null,clean(item.mediaType,30)||null,safeUrl(item.quotedUrl),safeUrl(item.coverUrl),hashtags,feedSurface(provenance),metric(item.creatorFollowers),outboundUrls,clean(item.relationType,30)||null,clean(item.relatedVideoId,120)||null,clean(item.visualHash,64)||null));''',
r'''   evidenceStatements.push(db().prepare(`INSERT INTO evidence_rich(owner,id,observed,replies,reposts,bookmarks,quotes,comments,shares,saves,sound_id,sound_title,sound_author,media_type,quoted_url,cover_url,hashtags,feed_surface,creator_followers,outbound_urls,relation_type,related_video_id,visual_hash,transcript,transcript_source,transcript_status,transcript_duration,video_about,video_subject,video_event,video_meaning_confidence,video_meaning_method,video_meaning_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,id,observed) DO UPDATE SET replies=excluded.replies,reposts=excluded.reposts,bookmarks=excluded.bookmarks,quotes=excluded.quotes,comments=excluded.comments,shares=excluded.shares,saves=excluded.saves,sound_id=excluded.sound_id,sound_title=excluded.sound_title,sound_author=excluded.sound_author,media_type=excluded.media_type,quoted_url=excluded.quoted_url,cover_url=excluded.cover_url,hashtags=excluded.hashtags,feed_surface=excluded.feed_surface,creator_followers=excluded.creator_followers,outbound_urls=excluded.outbound_urls,relation_type=excluded.relation_type,related_video_id=excluded.related_video_id,visual_hash=excluded.visual_hash,transcript=excluded.transcript,transcript_source=excluded.transcript_source,transcript_status=excluded.transcript_status,transcript_duration=excluded.transcript_duration,video_about=excluded.video_about,video_subject=excluded.video_subject,video_event=excluded.video_event,video_meaning_confidence=excluded.video_meaning_confidence,video_meaning_method=excluded.video_meaning_method,video_meaning_status=excluded.video_meaning_status`)
    .bind(user.userId,id,observed,metric(item.replies),metric(item.reposts),metric(item.bookmarks),metric(item.quotes),metric(item.comments),metric(item.shares),metric(item.saves),clean(item.soundId,120)||null,clean(item.soundTitle,240)||null,clean(item.soundAuthor,160)||null,clean(item.mediaType,30)||null,safeUrl(item.quotedUrl),safeUrl(item.coverUrl),hashtags,feedSurface(provenance),metric(item.creatorFollowers),outboundUrls,clean(item.relationType,30)||null,clean(item.relatedVideoId,120)||null,clean(item.visualHash,64)||null,clean(item.transcript,24000)||null,clean(item.transcriptSource,80)||null,clean(item.transcriptStatus,40)||null,finite(item.transcriptDuration),clean(item.videoAbout,600)||null,clean(item.videoSubject,240)||null,clean(item.videoEvent,320)||null,finite(item.videoMeaningConfidence),clean(item.videoMeaningMethod,80)||null,clean(item.videoMeaningStatus,40)||null));''')

append_once('BUGLOG.md', 'V27-TRANSCRIPT-EVERY-VIDEO', r'''

## V27-TRANSCRIPT-EVERY-VIDEO — 2026-09-15

**Root cause:** Front v26 had transcript-aware semantic fields, but the only populated transcript source was an optional HTML video text track inside the small prioritized visual-analysis budget (deep=2/scout=1). Most collected X/TikTok videos therefore never received speech-to-text, and semantic clustering could not reliably use spoken content.

**Permanent fix:** v27 adds a first-class all-video transcription stage with native caption fast-path + local whisper.cpp fallback, an all-video meaning stage that fuses caption/transcript/visual evidence, strict failure accounting, live transcript/meaning display, persisted rich transcript fields, and release-gate coverage requirements. Expensive multi-frame vision remains prioritized, while low-information silent clips receive a lightweight visual fallback.
''')

Path('browser-bridge/setup-transcription.command').chmod(0o755)
for transient in [
    'scripts/apply-v27-transcript-patch.mjs',
    'scripts/apply-v27-transcript-patch.py',
    '.github/workflows/apply-v27-transcript-patch.yml',
]:
    Path(transient).unlink(missing_ok=True)
print('v27 transcript integration patch applied')
