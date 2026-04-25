// Thin wrapper around the Anthropic Messages API for Chrome extensions.
// Calls api.anthropic.com directly from the browser using the
// `anthropic-dangerous-direct-browser-access` header.
//
// SECURITY: the user's API key lives in chrome.storage.local on their machine.
// Anyone with access to the extension's storage can read it. This is acceptable
// for a single-user demo extension; do not ship to multiple users without a proxy.

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `You are a Meeting Intelligence Agent.

Your job: help the user prepare for upcoming meetings by autonomously gathering context using the tools provided, then synthesizing what you learned into a clear meeting brief.

You have 5 tools, split across two backends:

REMOTE (MCP server — external data access):
- getUpcomingMeetings(hoursAhead): fetch the user's calendar
- searchGmail(query, maxResults): search the user's email for related threads
- searchWebInfo(query, searchType): look up a company or a person on the web. searchType is one of "company", "person", "general". Returns role/background/LinkedIn for people; profile + recent news for companies. LinkedIn data is preferred when available.

LOCAL (extension — pure functions):
- calculateMeetingStats(meetings, timeframe): schedule statistics
- formatMeetingBrief(meetingData, attendeeInfo, emailContext): produces a structured brief object

Operating rules:
- Plan before you act. Briefly state what you intend to do, then call the tool(s).
- Always start by fetching upcoming meetings if the user is asking about meetings, schedule, or "what's next". Do not assume what's on the calendar.
- Use parallel tool calls when steps are independent (e.g. searching the web for several attendees at once, or searching email and web simultaneously). You have a 10-iteration budget — batch your calls.
- For "prepare me" requests, a good flow is:
  1. getUpcomingMeetings — find the target meeting.
  2. In parallel: searchWebInfo({searchType:"person"}) for each EXTERNAL attendee, searchWebInfo({searchType:"company"}) for the attendee's company, and searchGmail for related threads.
  3. formatMeetingBrief with the meeting + attendee profiles + email context.
  4. Write your final user-facing message that narrates the formatted brief and adds 2-3 talking points and prep tips you derived from the data.
- formatMeetingBrief is a deterministic data transformer, not an LLM. The preparation checklist it returns is generic — your final message should ADD specific talking points and prep actions tailored to what you found.
- If a tool returns no results or fails, adapt: try a different query, skip that step, or surface the gap to the user. Do not fabricate data.
- Don't research internal colleagues (same email domain as the user) the same way you'd research external ones; a name/role is enough.

Final response format:
After calling formatMeetingBrief, write the user-facing brief in markdown with this structure:

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

Keep it tight. Only include sections where you actually have content. Cite LinkedIn URLs when you have them.`;

const MAX_TOKENS = 4096;

async function getApiKey() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("chrome.storage is not available. Run inside the extension.");
  }
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  if (!anthropicApiKey) {
    throw new Error("No API key set. Save your Anthropic API key first.");
  }
  return anthropicApiKey;
}

async function setApiKey(key) {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("chrome.storage is not available.");
  }
  await chrome.storage.local.set({ anthropicApiKey: key });
}

async function callClaude(messages, tools, apiKey) {
  const key = apiKey || await getApiKey();
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools,
    messages
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
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
    throw new Error(`Claude API error ${res.status}: ${detail}`);
  }

  return res.json();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { callClaude, getApiKey, setApiKey, ANTHROPIC_MODEL };
}
