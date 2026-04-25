// Manual agent loop. Calls Claude, executes any tool_use blocks against the
// right backend (local function or MCP server), feeds results back, and stops
// when Claude returns end_turn or the safety cap is hit.
//
// Callbacks let the UI render the reasoning chain live:
//   onStep(step)        -> "loading" -> ("retrying" if first attempt failed) -> "success" | "error"
//                          step.origin is "local" or "mcp"
//   onAssistantText(s)  -> any text Claude emits between tool calls
//   onFinalText(s)      -> Claude's final user-facing message
//   onError(err)        -> fatal error (network, auth, unknown tool, etc.)

const MAX_ITERATIONS = 10;

// Build a dispatcher closure that knows which tools are local vs remote.
function buildDispatcher(mcpTools) {
  const mcpNames = new Set(mcpTools.map(t => t.name));
  return {
    originOf(name) { return mcpNames.has(name) ? "mcp" : "local"; },
    async execute(name, input) {
      if (mcpNames.has(name)) return callMcpTool(name, input);
      return executeLocalTool(name, input);
    }
  };
}

// Run a tool, retry once on failure. Surfaces the first attempt's error to onRetry.
async function executeWithRetry(dispatcher, toolName, toolInput, onRetry) {
  try {
    return { ok: true, result: await dispatcher.execute(toolName, toolInput) };
  } catch (err1) {
    const msg1 = err1 && err1.message ? err1.message : String(err1);
    if (onRetry) onRetry(msg1);
    try {
      return { ok: true, result: await dispatcher.execute(toolName, toolInput), retried: true };
    } catch (err2) {
      const msg2 = err2 && err2.message ? err2.message : String(err2);
      return { ok: false, error: msg2, firstError: msg1, retried: true };
    }
  }
}

async function runAgent(userQuery, callbacks = {}) {
  const {
    onStep = () => {},
    onAssistantText = () => {},
    onFinalText = () => {},
    onError = () => {}
  } = callbacks;

  let stepNumber = 0;

  try {
    // Discover MCP tools at the start of the run. If the server is down, fail fast.
    const mcpTools = await fetchMcpTools();
    const allTools = [...LOCAL_TOOLS, ...mcpTools];
    const dispatcher = buildDispatcher(mcpTools);

    const conversationHistory = [
      { role: "user", content: userQuery }
    ];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await callClaude(conversationHistory, allTools);

      // Surface any text content Claude produced this turn.
      const textBlocks = response.content.filter(b => b.type === "text");
      for (const tb of textBlocks) {
        if (tb.text && tb.text.trim()) onAssistantText(tb.text);
      }

      // Append assistant's full content before sending tool_results — the API
      // requires every tool_use block to be paired with a tool_result on the next user turn.
      conversationHistory.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const finalText = textBlocks.map(t => t.text).join("\n").trim();
        onFinalText(finalText);
        return { conversationHistory, stopReason: response.stop_reason };
      }

      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

      // Execute each tool sequentially.
      const toolResults = [];
      for (const block of toolUseBlocks) {
        stepNumber++;
        const stepId = stepNumber;
        const origin = dispatcher.originOf(block.name);

        onStep({
          stepId,
          origin,
          status: "loading",
          toolName: block.name,
          toolInput: block.input
        });

        const outcome = await executeWithRetry(dispatcher, block.name, block.input, (firstErrMsg) => {
          onStep({
            stepId,
            origin,
            status: "retrying",
            toolName: block.name,
            toolInput: block.input,
            error: firstErrMsg
          });
        });

        if (outcome.ok) {
          onStep({
            stepId,
            origin,
            status: "success",
            toolName: block.name,
            toolInput: block.input,
            result: outcome.result,
            retried: outcome.retried || false
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(outcome.result)
          });
        } else {
          onStep({
            stepId,
            origin,
            status: "error",
            toolName: block.name,
            toolInput: block.input,
            error: outcome.error,
            firstError: outcome.firstError,
            retried: true
          });
          // Hand the error back to Claude so it can adapt (try a different query,
          // skip the step) rather than aborting the whole run.
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Tool error after one retry: ${outcome.error}`
          });
        }
      }

      conversationHistory.push({ role: "user", content: toolResults });
    }

    const capMsg = `Stopped after ${MAX_ITERATIONS} iterations without a final answer. The agent may be stuck in a loop.`;
    onError(new Error(capMsg));
    return { stopReason: "max_iterations" };
  } catch (err) {
    onError(err);
    throw err;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { runAgent, MAX_ITERATIONS };
}
