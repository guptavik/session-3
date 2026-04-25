// Thin wrapper around Google's Gemini REST API for Chrome extensions.
//
// Gemini's request/response shape differs from Anthropic's. Internally,
// agent.js still operates on Anthropic-style messages (role + content
// blocks of type text / tool_use / tool_result). This file translates
// at the API boundary so agent.js doesn't need to change.
//
// SECURITY: the user's API key lives in chrome.storage.local on their
// machine. Anyone with extension storage access can read it. Acceptable
// for a single-user demo; do not ship to multiple users without a proxy.

const GEMINI_MODEL   = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are a Meeting Intelligence Agent.

Your job: help the user prepare for upcoming meetings by autonomously gathering context using the tools provided, then synthesizing what you learned into a clear meeting brief.

You have 5 tools:
- getUpcomingMeetings: fetch calendar
- analyzeAttendeeBackground: profile a single attendee by email (returns role, company, LinkedIn URL)
- searchWebInfo: look up a company or person on the web; LinkedIn data is preferred when available
- searchGmail: search the user's email for related threads
- calculateMeetingStats: compute schedule statistics

Operating rules:
- Plan before you act. Briefly state what you intend to do, then call the tool(s).
- Always start by fetching upcoming meetings if the user is asking about meetings, schedule, or "what's next". Do not assume what's on the calendar.
- Use parallel tool calls when steps are independent (e.g. analyzing several attendees at once, or searching email and web simultaneously). You have a tight iteration budget — batch your calls.
- For "prepare me" requests, a good flow is: (1) fetch meetings, (2) in parallel, profile each external attendee AND search the web for their company AND search email for related threads, (3) write the final brief. Try to keep this under 4 tool-calling turns.
- If a tool returns no results or fails, adapt: try a different query, skip that step, or note the gap. Do not fabricate data.
- Don't research attendees who aren't on the meeting the user cares about. Don't research internal colleagues (your own company) the same way you'd research external ones.

Final response format:
When you're done gathering context, write the meeting brief directly in your final message as markdown with this structure:

# <Meeting Title>
**When:** ...   **Where:** ...
**Agenda:** ...

## Attendees
- **Name**, Role at Company — short background. LinkedIn: <url if known>

## Company Context
Short paragraph + recent news bullets if relevant.

## Related Email Context
- *date* — **subject** from sender — one-line takeaway

## Talking Points
- Concrete topics to raise, grounded in what you found above.

## Prep Checklist
- [ ] Concrete actions for the user before the meeting.

Keep the brief tight. Only include sections where you actually have content. Cite LinkedIn URLs when you have them.

If briefing on multiple meetings (e.g. "show me everything today"), write a one-line intro, then repeat the structure above for each meeting — each one MUST start with its own \`# <Meeting Title>\` heading (single hash). Do not number the meeting titles. The UI groups everything under one \`#\` heading into a single collapsible card per meeting.`;

const MAX_OUTPUT_TOKENS = 4096;

async function getApiKey() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("chrome.storage is not available. Run inside the extension.");
  }
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error("No API key set. Save your Gemini API key first.");
  }
  return geminiApiKey;
}

async function setApiKey(key) {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("chrome.storage is not available.");
  }
  await chrome.storage.local.set({ geminiApiKey: key });
}

async function callLLM(messages, tools, apiKey) {
  const key = apiKey || await getApiKey();

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: convertMessagesToContents(messages),
    tools: convertToolsToFunctionDeclarations(tools),
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS
    }
  };

  const res = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Gemini API error ${res.status}: ${detail}`);
  }

  return convertGeminiResponseToAnthropicShape(await res.json());
}

// ---------- Format conversion ----------

// Convert Anthropic-style messages array to Gemini's contents array.
// Anthropic role "assistant" → Gemini role "model".
function convertMessagesToContents(messages) {
  // Pre-scan to build a tool_use_id → name map so tool_result blocks
  // (which only carry an id) can be converted to functionResponse parts
  // (which require the function name).
  const idToName = new Map();
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          idToName.set(block.id, block.name);
        }
      }
    }
  }

  return messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: convertContentToParts(m.content, idToName)
  }));
}

function convertContentToParts(content, idToName) {
  if (typeof content === "string") {
    return content.trim() ? [{ text: content }] : [{ text: " " }];
  }

  const parts = [];
  for (const block of content) {
    if (block.type === "text") {
      if (block.text) parts.push({ text: block.text });
    } else if (block.type === "tool_use") {
      parts.push({
        functionCall: {
          name: block.name,
          args: block.input || {}
        }
      });
    } else if (block.type === "tool_result") {
      const name = idToName.get(block.tool_use_id) || "unknown_function";
      let response = block.content;
      if (typeof response === "string") {
        try { response = JSON.parse(response); }
        catch { response = { result: response }; }
      }
      if (response === null || typeof response !== "object" || Array.isArray(response)) {
        response = { result: response };
      }
      if (block.is_error) {
        response = { error: typeof block.content === "string" ? block.content : JSON.stringify(block.content) };
      }
      parts.push({ functionResponse: { name, response } });
    }
  }

  // Gemini rejects empty parts arrays; emit a single space if everything
  // collapsed away (e.g. an empty assistant text block).
  return parts.length ? parts : [{ text: " " }];
}

// Convert Anthropic-style tool definitions (TOOLS array in tools.js)
// to Gemini's tools array shape.
function convertToolsToFunctionDeclarations(tools) {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema
    }))
  }];
}

// Convert Gemini's response to the Anthropic shape agent.js expects:
//   { content: [{type: "text"|"tool_use", ...}], stop_reason: "tool_use"|"end_turn" }
function convertGeminiResponseToAnthropicShape(geminiResp) {
  const candidate = geminiResp.candidates?.[0];
  if (!candidate) {
    const reason = geminiResp.promptFeedback?.blockReason || "unknown";
    throw new Error(`Gemini returned no candidates (blockReason: ${reason})`);
  }

  const parts = candidate.content?.parts || [];
  const content = [];
  let hasToolUse = false;

  for (const p of parts) {
    if (typeof p.text === "string" && p.text.length > 0) {
      content.push({ type: "text", text: p.text });
    } else if (p.functionCall) {
      hasToolUse = true;
      content.push({
        type: "tool_use",
        id: synthesizeToolUseId(),
        name: p.functionCall.name,
        input: p.functionCall.args || {}
      });
    }
  }

  if (content.length === 0) {
    throw new Error(`Gemini response had no usable content (finishReason: ${candidate.finishReason || "unknown"})`);
  }

  return {
    content,
    stop_reason: hasToolUse ? "tool_use" : "end_turn"
  };
}

// Gemini doesn't issue per-call IDs the way Anthropic does. agent.js needs
// stable IDs to match tool_use blocks back to tool_result blocks within the
// same conversation, so we synthesize them here.
function synthesizeToolUseId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `gem_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `gem_${Math.random().toString(36).slice(2, 10)}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { callLLM, getApiKey, setApiKey, GEMINI_MODEL };
}
