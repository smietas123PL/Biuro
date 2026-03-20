export function computeExponentialBackoffDelay(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number
) {
  const safeMin = Math.max(0, minDelayMs);
  const safeMax = Math.max(safeMin, maxDelayMs);
  const multiplier = Math.max(0, attempt);

  return Math.min(safeMax, safeMin * 2 ** multiplier);
}

export async function waitForDelay(ms: number) {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
