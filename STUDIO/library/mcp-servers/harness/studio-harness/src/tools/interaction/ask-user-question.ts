// ask_user_question is intercepted by the STUDIO frontend before reaching the MCP subprocess.
// This handler only fires if the intercept is somehow bypassed.
export async function askUserQuestion(
  _args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return { error: "ask_user_question must be handled by the host UI." };
}
