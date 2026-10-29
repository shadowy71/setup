// The Analytics and Speed Insights packages default to fixed /_vercel/* script
// URLs in production. Those rewrites exist on Vercel, not on a local, container,
// or otherwise self-hosted Next server. Keep hosted telemetry, but do not turn
// every non-Vercel page view into two guaranteed missing-script requests.
export function shouldUseVercelTelemetry(env = process.env) {
  return env.VERCEL === '1';
}
