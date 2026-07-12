export async function sleep(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const seconds = args.seconds as number;
  await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
  return { slept_seconds: seconds };
}
