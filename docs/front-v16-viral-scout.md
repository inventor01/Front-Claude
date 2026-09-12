# Front v16 · Viral Narrative Scout

## Root problem

The browser bridge already collected X/TikTok evidence and investigated candidate topics, but broad scrolling was still mainly quota-driven. It did not have a single explicit operating policy for deciding what deserves attention, when to stop broad scrolling, when to switch into focused investigation, and how to handle posts whose publish time is unavailable.

That creates three avoidable failure modes: wasting scan time after a promising event is already visible, investigating candidates in generic detector order rather than evidence priority, and losing useful velocity information for undated posts after correctly refusing to invent their age.

## Permanent changes

### 1. Viral Narrative Scout skill

`browser-bridge/skills/front-viral-scout/SKILL.md` is the operating contract for Scout → Focus → Investigate → Verify Origin → Monitor. The critical gates are implemented in code rather than relying on prose alone.

### 2. Signal-aware scrolling

Each For You feed pass is evaluated for independent repeated language, repeated media/context, and fast independent creators. A sufficiently strong signal stops broad scrolling early with audit reason `signal-found`.

One viral creator cannot trigger this focus gate by itself.

### 3. Focus-first investigation

After recommendation-feed discovery, candidate narratives are ranked by independent creators, measured/age-based velocity, repeated media, same-event cross-platform corroboration, momentum and feed penetration. Strong candidates are investigated on X and TikTok before generic trend/sentinel expansion.

When a scout candidate is especially strong, generic trend seeds are skipped for that run and sentinel breadth is reduced. Explicit user-configured hunt phrases are never skipped.

### 4. Real snapshot velocity

Posts with real publish timestamps still use age-based velocity. Posts without timestamps never receive a fabricated age. Instead, Front stores metric snapshots and computes views/minute and likes/minute only after two real measurements separated by at least one minute.

The production feed also derives velocity from its persisted `observations` table, so an undated post can become correctly ranked after repeated observations without trusting client-supplied age.

### 5. Explainable scan audit

Bridge health/audit now reports scout skill version, why broad scrolling stopped, focus candidates and their reasons, the broadening plan, and how many posts have measured snapshot velocity.

## Hard gates retained

- automatic narrative promotion still requires independent creator support
- generic/social boilerplate rejection remains enforced
- raw X+TikTok presence is not same-event corroboration
- a single viral post is not a narrative
- Pump.fun provenance still comes only from PumpPortal `subscribeNewToken` create events
- DEX data is market enrichment, not launch verification
