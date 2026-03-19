import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const minimumPct = 70;
const gatedMetrics = ['lines', 'statements', 'functions'];
const reportedMetrics = [...gatedMetrics, 'branches'];

const packageReports = [
  {
    name: 'server',
    summaryPath: path.join(
      repoRoot,
      'packages',
      'server',
      'coverage',
      'coverage-summary.json'
    ),
  },
  {
    name: 'dashboard',
    summaryPath: path.join(
      repoRoot,
      'packages',
      'dashboard',
      'coverage',
      'coverage-summary.json'
    ),
  },
];

function formatMetric(metric) {
  return `${metric.covered}/${metric.total} (${metric.pct.toFixed(2)}%)`;
}

function mergeMetric(metrics) {
  const total = metrics.reduce((sum, metric) => sum + metric.total, 0);
  const covered = metrics.reduce((sum, metric) => sum + metric.covered, 0);

  return {
    total,
    covered,
    pct: total === 0 ? 100 : (covered / total) * 100,
  };
}

const reportEntries = await Promise.all(
  packageReports.map(async ({ name, summaryPath }) => {
    const raw = await readFile(summaryPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      name,
      summary: parsed.total,
    };
  })
);

console.log('Coverage summary by package:');
for (const entry of reportEntries) {
  const metrics = reportedMetrics
    .map(
      (metricName) =>
        `${metricName}: ${formatMetric(entry.summary[metricName])}`
    )
    .join(', ');
  console.log(`- ${entry.name}: ${metrics}`);
}

const merged = Object.fromEntries(
  reportedMetrics.map((metricName) => [
    metricName,
    mergeMetric(reportEntries.map((entry) => entry.summary[metricName])),
  ])
);

console.log('\nMerged monorepo coverage:');
for (const metricName of reportedMetrics) {
  console.log(`- ${metricName}: ${formatMetric(merged[metricName])}`);
}

const failing = gatedMetrics.filter(
  (metricName) => merged[metricName].pct < minimumPct
);
if (failing.length > 0) {
  console.error(
    `\nCoverage gate failed. Required >= ${minimumPct}% for ${failing.join(', ')} in merged monorepo coverage.`
  );
  process.exit(1);
}

console.log(
  `\nCoverage gate passed at >= ${minimumPct}% for merged lines, statements, and functions.`
);
