# Browser alert migration subscription — 2026-09-16

## Root cause

The global browser PumpPortal runtime subscribed only to `subscribeNewToken`, while `NarrativeCreationWatcher` also contained logic for `txType === 'migrate'` and attempted to issue graduation browser notifications. Because the browser WebSocket never subscribed to migration events, that graduation branch could not receive live browser-side migration messages.

Creation alerts were otherwise wired correctly: notification permission is requested from a user gesture in Settings, exact-name watches persist in `localStorage`, the global watcher is mounted from the root layout, and matching creation events call the browser Notification API when permission is granted.

## Permanent fix

- Subscribe the single shared browser PumpPortal socket to both `subscribeNewToken` and `subscribeMigration` when it opens.
- Update the visible runtime state to `Connected · creations + migrations`.
- Keep the one-socket lifecycle and reconnect behavior unchanged.
- Do not duplicate subscriptions when Settings re-enables an already-open socket.

## Regression coverage

`tests/pumpportal-runtime-lifecycle.test.mjs` now verifies:

- exactly one WebSocket is created for the shared browser runtime;
- the open socket sends exactly one `subscribeNewToken` and one `subscribeMigration` request;
- both creation and migration wire events reach message subscribers;
- repeated enable does not restart the socket or duplicate subscriptions;
- UI unmount/remount does not close the shared socket;
- explicit disable/re-enable closes and replaces the socket as expected.

## User verification

Browser notifications still depend on browser/OS permission. In Front Settings, click **Browser alerts** and allow notifications, then enable **Start listening**. Creation alerts require either an exact-name watch or a strong Front narrative match. Graduation alerts require a previously observed creation/match for the same mint.
