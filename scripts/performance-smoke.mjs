#!/usr/bin/env node

const baseUrl = new URL(process.env.PERF_BASE_URL || process.env.BASE_URL || 'https://alkmara.vercel.app');
const requestCount = boundedInt('PERF_REQUESTS', 20, 1, 500);
const concurrency = boundedInt('PERF_CONCURRENCY', 5, 1, 50);
const p95LimitMs = boundedInt('PERF_P95_LIMIT_MS', 1000, 1, 60_000);
const maxErrorRate = boundedNumber('PERF_MAX_ERROR_RATE', 0, 0, 1);

const targets = [
  { name: 'Login page', path: '/login', expectedStatus: 200, cacheBust: false },
  { name: 'Public school info (DB)', path: '/api/public/school-info', expectedStatus: 200, cacheBust: true },
  { name: 'Protected API guard', path: '/api/students', expectedStatus: 401, cacheBust: true },
];

function boundedInt(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function boundedNumber(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

function percentile(sorted, percentileValue) {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function targetUrl(target, sequence) {
  const url = new URL(target.path, baseUrl);
  if (target.cacheBust) url.searchParams.set('__perf', `${Date.now()}-${sequence}`);
  return url;
}

async function measure(target, sequence) {
  const start = performance.now();
  try {
    const response = await fetch(targetUrl(target, sequence), {
      headers: { accept: 'application/json,text/html;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    return {
      ok: response.status === target.expectedStatus,
      status: response.status,
      ms: performance.now() - start,
    };
  } catch (error) {
    return { ok: false, status: 'ERR', ms: performance.now() - start, error: error.message };
  }
}

async function benchmark(target) {
  await measure(target, 'warmup');

  const results = new Array(requestCount);
  let cursor = 0;
  async function worker() {
    while (cursor < requestCount) {
      const index = cursor++;
      results[index] = await measure(target, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));

  const latencies = results.map((result) => result.ms).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  return {
    target: target.name,
    expected: target.expectedStatus,
    requests: requestCount,
    errors: failures.length,
    errorRate: failures.length / requestCount,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.at(-1) || 0,
    statuses: [...new Set(results.map((result) => result.status))].join(', '),
  };
}

console.log(`Read-only performance smoke: ${baseUrl.origin}`);
console.log(`Requests/target=${requestCount}, concurrency=${concurrency}, p95 limit=${p95LimitMs}ms`);

const summaries = [];
for (const target of targets) summaries.push(await benchmark(target));

console.table(summaries.map((summary) => ({
  target: summary.target,
  status: summary.statuses,
  requests: summary.requests,
  errors: summary.errors,
  p50_ms: Math.round(summary.p50),
  p95_ms: Math.round(summary.p95),
  p99_ms: Math.round(summary.p99),
  max_ms: Math.round(summary.max),
})));

const violations = summaries.filter(
  (summary) => summary.errorRate > maxErrorRate || summary.p95 > p95LimitMs,
);
if (violations.length > 0) {
  for (const summary of violations) {
    console.error(
      `FAIL ${summary.target}: error rate ${(summary.errorRate * 100).toFixed(1)}%, p95 ${Math.round(summary.p95)}ms`,
    );
  }
  process.exitCode = 1;
} else {
  console.log('PASS: status codes, error rate, and p95 are within the configured limits.');
}
