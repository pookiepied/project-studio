// A coding harness should never block the session for long, and the model
// occasionally passes garbage. Validate and cap.
const MAX_SLEEP_SECONDS = 60;

export async function sleep(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const requested = args.seconds;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested < 0) {
    return { error: "seconds must be a non-negative, finite number." };
  }
  const seconds = Math.min(requested, MAX_SLEEP_SECONDS);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
  return {
    slept_seconds: seconds,
    ...(seconds < requested ? { capped: true, requested_seconds: requested, max_seconds: MAX_SLEEP_SECONDS } : {}),
  };
}
