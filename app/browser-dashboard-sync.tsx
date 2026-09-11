'use client';

import { useEffect } from 'react';

export default function BrowserDashboardSync() {
  useEffect(() => {
    const refresh = () => {
      // Desk keeps its discovery state client-side. Reload only after a completed
      // evidence save so the primary Narrative Radar immediately fetches the
      // merged stored-browser + public feed. This is deliberately not triggered
      // while collection is running.
      window.setTimeout(() => window.location.reload(), 350);
    };
    window.addEventListener('front-browser-evidence-saved', refresh);
    return () => window.removeEventListener('front-browser-evidence-saved', refresh);
  }, []);
  return null;
}
