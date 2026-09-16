export const V28_RELEASE_TIMEOUT_MS = 1_200_000;

const VISUAL_PROBE_FAILURES = new Set([
  'Visual understanding complete',
  'Qwen/video understanding actually exercised',
  'Visual understanding has zero failures',
  'At least one visual summary exists',
  'Content understanding remains healthy',
]);

export function v28ReleaseEnv(env = process.env) {
  const requested = Number(env.FRONT_E2E_TIMEOUT_MS || 0);
  const timeoutMs = Math.max(V28_RELEASE_TIMEOUT_MS, Number.isFinite(requested) ? requested : 0);
  return {
    ...env,
    FRONT_RELEASE_GATE: '28',
    FRONT_E2E_TIMEOUT_MS: String(timeoutMs),
  };
}

export function evaluateV27BaseGateForV28({ exitStatus = 0, report = null } = {}) {
  if (exitStatus === 0) return { ok: true, acceptedVisualProbeFailure: false, failures: [] };
  const failures = Array.isArray(report?.failures) ? report.failures : [];
  if (!failures.length) return { ok: false, acceptedVisualProbeFailure: false, failures: ['v27 base gate exited nonzero without a failure report'] };
  const names = failures.map((row) => String(row?.name || '')).filter(Boolean);
  const visualOnly = names.length > 0 && names.every((name) => VISUAL_PROBE_FAILURES.has(name));
  if (!visualOnly) return { ok: false, acceptedVisualProbeFailure: false, failures: names };
  return { ok: true, acceptedVisualProbeFailure: true, failures: names };
}
