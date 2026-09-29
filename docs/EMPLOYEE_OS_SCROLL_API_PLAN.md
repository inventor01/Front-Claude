# Front Scrolling API Plan

## Goal

Make Front the single intelligence gateway used by AI Employee OS for authenticated X/TikTok scrolling, discovery, evidence capture, and normalized research results.

AI Employee OS must never receive X/TikTok cookies, passwords, browser profiles, or platform session tokens.

## Architecture

```
AI Employee OS
  -> Front Cloud API
      -> durable scroll job in Front D1
          <- local Front browser bridge polls outbound
              -> authenticated Chrome on the user's Mac
              -> X / TikTok scrolling + extraction
              -> transcripts / visual understanding / narrative analysis
          -> local bridge uploads normalized evidence + progress
      -> Front normalizes/stores result
  <- AI Employee OS polls/reads result
```

The cloud cannot initiate a connection to `127.0.0.1:43981`. The local bridge therefore acts as the worker and polls Front Cloud for work.

## Job lifecycle

`QUEUED -> CLAIMED -> SCROLLING -> ANALYZING -> UPLOADING -> COMPLETED`

Exceptional states:

- `WAITING_FOR_BRIDGE`: no bridge heartbeat.
- `WAITING_FOR_LOGIN`: Chrome profile is not authenticated.
- `RATE_LIMITED`: platform rate/temporary restriction detected.
- `CANCELLED`: user or Employee OS cancels.
- `FAILED`: terminal scanner error.
- `EXPIRED`: job exceeded its deadline.

Never create a replacement job on retry. Retry/reclaim the same job ID.

## Cloud API

### POST /api/agent/scroll-jobs

Authenticated with the Front service key already used by AI Employee OS.

Request:

```json
{
  "requestId": "employee-os-job-or-action-id",
  "mode": "scout",
  "platforms": ["X", "TikTok"],
  "objective": "Find emerging products and creative patterns for lightweight hoodies",
  "keywords": ["hoodie", "streetwear", "oversized hoodie"],
  "accounts": [],
  "surfaces": ["FOR_YOU", "SEARCH"],
  "targetUniqueFeedItems": 90,
  "maxSeconds": 120,
  "maxScrolls": 48,
  "analysis": {
    "transcribeVideos": true,
    "visualUnderstanding": true,
    "contextUnderstanding": true,
    "deriveNarratives": true
  }
}
```

Response:

```json
{
  "id": "front-scroll-job-id",
  "status": "QUEUED",
  "deduplicated": false
}
```

`requestId` is unique per caller and is the idempotency key.

### GET /api/agent/scroll-jobs/:id

Returns status, phase, heartbeat, counts, limitations, and result summary.

### POST /api/agent/scroll-jobs/:id/cancel

Marks cancellation requested. The bridge stops the matching local scan and reports `CANCELLED`.

### GET /api/agent/scroll-jobs/claim

Bridge-authenticated long-poll/poll endpoint. Atomically leases one queued job.

### POST /api/agent/scroll-jobs/:id/heartbeat

Bridge sends current phase, observed count, platform counts, scan ID, and login/browser health.

### POST /api/agent/scroll-jobs/:id/evidence

Uploads evidence in bounded chunks. Reuse Front's current evidence validation and dedupe contract.

### POST /api/agent/scroll-jobs/:id/complete

Uploads final scan ledger/result and marks the job terminal.

## Local bridge worker

Add a small outbound `cloud-agent.mjs` loop to the existing browser bridge.

Responsibilities:

1. Heartbeat Front Cloud.
2. Claim one scroll job when idle.
3. Convert the cloud request into the existing v27 `/scan` request.
4. Execute through the existing single-process browser scanner.
5. Stream progress every few seconds.
6. Upload evidence progressively so a long scan still produces useful partial evidence.
7. Upload final narrative/scan result.
8. Never expose Chrome cookies/profile data.

The local bridge remains bound to `127.0.0.1`.

## Scrolling behavior

Use the existing v27 scanner rather than a second implementation.

### X

- Open authenticated X Home.
- Select For You when available.
- Extract post ID, author, body, timestamp, engagement and URLs.
- Scroll until one of:
  - target unique items reached;
  - max seconds reached;
  - max scroll count reached;
  - stale/exhausted feed threshold reached;
  - cancellation requested.
- Run focused live searches for supplied keywords after broad feed sampling.

### TikTok

- Use the existing authenticated TikTok observer/collector.
- Sample For You / Explore/Search depending on requested surfaces.
- Deduplicate canonical video URLs.
- Preserve caption, creator, engagement when available, cover/media refs and hashtags.
- Continue scrolling until the same bounded stop conditions.

## Output contract for AI Employee OS

Employee OS should receive normalized intelligence, not raw browser state:

```json
{
  "status": "VERIFIED",
  "captureMethod": "FRONT_LOCAL_BROWSER",
  "jobId": "front-scroll-job-id",
  "capturedAt": "ISO-8601",
  "platforms": ["X", "TikTok"],
  "evidence": [],
  "topics": [],
  "products": [],
  "creativePatterns": [],
  "metrics": {
    "observed": 90,
    "unique": 74,
    "scrolls": 18
  },
  "confidence": "HIGH",
  "limitations": []
}
```

Employee OS keeps launch authority. Front provides evidence/intelligence only.

## Automatic Employee OS connection

Front is the sole permitted shared project dependency.

1. Front owns one service credential.
2. Railway stores that credential on Front Cloud.
3. Employee OS receives the matching credential only during bootstrap.
4. Employee OS verifies `/api/commerce-intel` and `/api/agent/capabilities`.
5. Employee OS encrypts the Front credential in `integration_credentials`.
6. Bootstrap env material is removed.
7. Startup health checks verify the encrypted connection, not environment secrets.
8. Employee OS never presents a manual Front key field during normal operation.

## New capability endpoint

### GET /api/agent/capabilities

Returns:

```json
{
  "service": "front",
  "role": "intelligence-only",
  "launchAuthority": false,
  "scrollJobs": true,
  "platforms": ["X", "TikTok"],
  "requiresLocalBridge": true,
  "bridge": {
    "online": true,
    "authenticatedPlatforms": ["X", "TikTok"]
  }
}
```

Employee OS readiness treats:
- Front Cloud connected + bridge online + platform authenticated = `CONNECTED`.
- Front Cloud connected but bridge offline = `DEGRADED_READY` for stored intelligence, `WAITING_FOR_BRIDGE` for new scrolling.
- Front Cloud unavailable = `BLOCKED_EXTERNAL_AUTH`.

## Security

- Separate service key for Employee OS -> Front.
- Separate bridge credential for local bridge -> Front Cloud.
- Bridge credential can only claim/update scroll jobs and upload evidence.
- Employee OS credential cannot access browser cookies or bridge internals.
- Constant-time credential comparison.
- Request body limits.
- URL/platform allowlists.
- Idempotency by caller `requestId`.
- D1 lease/heartbeat prevents duplicate scanners claiming the same job.
- Evidence uploads are replay-safe.
- Never log service keys or browser/session secrets.

## Data model

New migration tables:

- `agent_scroll_jobs`
  - owner
  - id
  - caller
  - request_id
  - status
  - request_json
  - phase
  - lease_id
  - lease_expires_at
  - bridge_id
  - scan_id
  - observed_count
  - platform_counts
  - result_json
  - limitations
  - error
  - created
  - started
  - heartbeat
  - completed

Unique index: `(owner, caller, request_id)`.

- `bridge_agents`
  - owner
  - id
  - token_hash
  - label
  - status
  - last_seen
  - capabilities
  - created

Do not store raw bridge token after creation.

## Employee OS changes

Add `src/front-scroll.ts`:

- `createScrollJob()`
- `getScrollJob()`
- `cancelScrollJob()`
- `waitForScrollJob()`

Add worker step `FRONT_SCROLL` ahead of `FRONT_SCAN` for research jobs that explicitly need fresh discovery.

Behavior:

1. Create/reuse Front scroll job using Employee OS job/step id as idempotency key.
2. Wait asynchronously through retry scheduling; never block a worker process for minutes.
3. On completion, record Front evidence IDs.
4. Feed fresh evidence into demand/product/creative analysis.
5. If bridge is offline, use stored Front intelligence/public research and mark result degraded rather than inventing evidence.

## Release gates

1. Duplicate `POST` with same requestId produces exactly one Front job.
2. Two bridge workers cannot claim the same job.
3. Bridge loss returns job to claimable state after lease expiry.
4. X-only, TikTok-only and combined scans work.
5. Stop/cancel works during scrolling and model analysis.
6. Zero-result scan returns a truthful completed/degraded result.
7. No cookies, platform tokens, service keys or browser profile data appear in payloads/logs.
8. Employee OS receives at least one fresh Front evidence record in an end-to-end scrolling test.
9. Existing Front interactive scans continue working unchanged.
10. Front remains intelligence-only and cannot publish, buy, spend or launch.
