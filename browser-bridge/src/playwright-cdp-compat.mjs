import { chromium } from 'playwright';

const MARKER = Symbol.for('front.playwright.cdp-no-defaults.v1');

if (!globalThis[MARKER]) {
  const originalConnectOverCDP = chromium.connectOverCDP.bind(chromium);
  const wrapped = (endpointURL, options = {}) => originalConnectOverCDP(endpointURL, {
    ...options,
    // Chrome 152+ can expose a usable remote-debugging session while rejecting
    // Playwright's Browser.setDownloadBehavior default-context setup with
    // "Browser context management is not supported". Playwright added this
    // option specifically for CDP targets that already own their default context.
    noDefaults: options.noDefaults ?? true,
  });
  wrapped.frontCdpNoDefaults = true;
  chromium.connectOverCDP = wrapped;
  globalThis[MARKER] = true;
}

export const frontCdpCompatibilityEnabled = true;
