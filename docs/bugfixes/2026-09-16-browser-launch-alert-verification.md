# Browser launch alert verification — 2026-09-16

## Root cause

Browser launch notifications were already wired, but there was no focused regression tying together every required part of the browser notification path: the Settings permission request, the user-facing Browser alerts control, the app-level watcher mount, the granted-permission gate, the exact-name watch alert, the strong narrative-match alert, and the creation-only PumpPortal socket.

That missing regression made the intentionally absent browser migration subscription easy to misread as a defect during audit.

The browser PumpPortal runtime is intentionally creation-only. It owns one shared `subscribeNewToken` socket that survives internal Front navigation. Migration monitoring remains a separate background/server concern and existing regression coverage protects that boundary.

## Verification fix

- Keep the browser runtime on one shared `subscribeNewToken` socket.
- Keep `Notification.requestPermission()` behind the Settings **Browser alerts** user action.
- Keep `NarrativeCreationWatcher` mounted from the root layout so alert matching survives page navigation.
- Keep system notifications gated by `Notification.permission === 'granted'`.
- Verify exact-name watched creation events call the `Front launch alert` notification path.
- Verify strong Front narrative creation matches call the `NEW MATCHING COIN` notification path.
- Add these assertions to `tests/pumpportal-navigation-persistence.test.mjs` so the full wiring is checked in CI together with socket persistence.

## Limitations

Automated CI can verify Front's application wiring, but it cannot grant Chrome/macOS notification permission or prove the operating system displayed a notification. Browser and operating-system notification permission remain user-controlled.

## Manual verification

1. Open Front Settings.
2. Click **Browser alerts** and choose **Allow**.
3. Click **Start listening**.
4. Confirm the listener reports `Connected · creations only`.
5. Add an exact token-name watch.

A browser notification will fire when a newly created Pump.fun token exactly matches a watch, or when Front identifies a strong creation-time narrative match. A direct `new Notification(...)` test in the browser console can be used to verify Chrome/macOS display permission immediately without waiting for a matching token launch.
