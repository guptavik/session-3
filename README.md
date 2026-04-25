# Meeting Intelligence Agent

A Chrome extension that prepares you for upcoming meetings by autonomously gathering context — calendar, email, attendee profiles, company info — and synthesizing it into an actionable brief. Built on Google Gemini 2.5 Flash with a custom multi-step agent loop.

## What it does

Ask it questions like:

- *Prepare me for my next meeting*
- *Show me all meetings today and research the attendees*
- *What's my meeting load this week?*

It plans, calls 3–7 tools (calendar, email, web/LinkedIn, attendee profiles, stats), and returns a structured markdown brief with attendee cards, talking points, and a prep checklist.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Chrome Extension (Manifest V3)                           │
│                                                          │
│  popup.html / popup.js / styles.css   ← UI               │
│         │                                                │
│  agent.js   ← manual agent loop                          │
│         │                                                │
│  api.js   ── fetch() ──→ Gemini Generative Language API  │
│         │            x-goog-api-key header               │
│  tools.js / mockData.js   ← 5 tool implementations       │
│                                                          │
│  chrome.storage.local   ← API key                        │
└──────────────────────────────────────────────────────────┘
            │
            └─ direct browser → generativelanguage.googleapis.com
```

### Agent flow

The diagram above shows where files live. This one shows what runs in a single user query: the agent loop calls Gemini, lets it decide which tools to invoke, executes those tools locally, feeds the results back, and repeats until Gemini stops asking for tools.

```
┌──────────────────────────────────────────┐
│         CHROME EXTENSION                 │
│  ┌────────────────────────────────────┐ │
│  │  User Interface (popup.html)       │ │
│  └──────────────┬─────────────────────┘ │
│                 │                        │
│  ┌──────────────▼─────────────────────┐ │
│  │  Agent Loop (agent.js)             │ │
│  │  - Manages conversation history    │ │
│  │  - Calls Gemini API repeatedly     │ │
│  │  - Streams reasoning chain to UI   │ │
│  │  - Retries failed tool calls once  │ │
│  └──────────────┬─────────────────────┘ │
│                 │                        │
│  ┌──────────────▼─────────────────────┐ │
│  │  Local Tools (tools.js)            │ │
│  │  - getUpcomingMeetings             │ │
│  │  - searchGmail                     │ │
│  │  - searchWebInfo                   │ │
│  │  - analyzeAttendeeBackground       │ │
│  │  - calculateMeetingStats           │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
              ↓
    ┌─────────────────────────┐
    │   Gemini 2.5 Flash      │
    │   Typically 3–5 turns   │
    │   (parallel tool calls; │
    │   10-iteration cap)     │
    │   Decides tool order    │
    └─────────────────────────┘
```

Tools always run inside the extension. Gemini never sees calendar data, email contents, or attendee profiles directly — it only sees the JSON our tools return. Gemini's role is to decide *which* tool to call next and to write the final brief from the accumulated tool results.

### Key design choices

- **No backend, no MCP server.** The extension calls `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` directly with the `x-goog-api-key` header. All tools are local JavaScript functions reading from `mockData.js` — no network beyond Google.
- **Manual agent loop** (not the SDK tool runner). Gives the UI full visibility into each step for the live reasoning-chain display, retry logic, and per-step error feedback.
- **API-boundary translation.** `agent.js` operates internally on Anthropic-style messages (text / tool_use / tool_result blocks). `api.js` translates to and from Gemini's `contents` / `parts` / `functionCall` / `functionResponse` shape at the boundary, so the agent loop and tool definitions stay provider-agnostic. Swapping back to Anthropic — or adding any other provider — is a single-file change.
- **Mock data** for demoability. Calendar, email, attendees, and company info live in `mockData.js`. The mock calendar anchors meetings to "now" so the demo always has fresh content.

## Tools

Five tools, exposed to the LLM via JSON Schema in `tools.js`:

| Name | Returns | Implementation |
|---|---|---|
| `getUpcomingMeetings` | Calendar events within an hour window | Mock — anchored to current time |
| `searchGmail` | Email matches for a query | Mock — token-scored against a fixed set |
| `searchWebInfo` | Company or person profile, prefers LinkedIn URLs | Mock — `MOCK_COMPANIES` / `MOCK_PEOPLE` lookup |
| `analyzeAttendeeBackground` | Single attendee profile by email | Mock — `MOCK_PEOPLE` lookup, stub fallback for unknown emails |
| `calculateMeetingStats` | Total count, total hours, average duration, busiest day, distribution, hours-per-day, per-day load (free / light / medium / heavy / packed), and per-day meeting list | Real computation over input |

## Agent loop

```
user query
    │
    ▼
loop (max 10 iterations):
    callLLM(history, tools, system_prompt)
       │
       ▼
    if stop_reason != "tool_use": return final text
    for each tool_use block (sequential):
        execute (retry once on error)
        push tool_result (is_error: true on persistent failure)
    push assistant turn + tool_results into history
```

Implementation notes:

- **Cap of 10 iterations** prevents runaway loops.
- **Multiple `tool_use` blocks** in one assistant turn execute **sequentially** so the reasoning-chain UI orders them deterministically.
- **Tool failures** retry once silently; if still failing, the harness surfaces them as `is_error: true` tool results so the model can adapt (try a different query, skip the step, or note the gap).
- **Conversation history** is popup-scoped — closing the popup clears it. (No background service worker.)

## System prompt

The system prompt (`api.js`):

- Names the 5 tools with a one-line purpose for each.
- Encourages **parallel tool calls** to fit within the iteration cap.
- Specifies the markdown structure of the final brief: hero meta line, Attendees, Company Context, Related Emails, Talking Points, Prep Checklist.
- Instructs the model to use a separate `# Title` heading per meeting in multi-meeting briefs (the UI groups everything under one `#` into a collapsible card).

## UI

- **Gear popover** (top-right of the header) for the API key — saved to `chrome.storage.local`. Status dot: red = unset, green = saved. Auto-opens on first run if no key is stored; auto-closes on save. Click outside or press Escape to dismiss.
- **Quick action buttons** plus a custom query input.
- **Reasoning chain** — every tool call rendered as a collapsible row with status icon (loading, retrying, success, error). The whole chain itself is also collapsible. Reasoning prose the model emits between tool calls is rendered as a collapsed "thought" with a one-line preview.
- **Brief renderer** — the model's markdown output is post-processed into structured blocks:
  - Hero card with meeting title on a Gmail-red gradient and the When/Where/Agenda meta strip.
  - Attendee cards with initial-letter avatar circles.
  - Email cards with date pills.
  - Talking points as numbered cards.
  - Prep checklist as checkbox-styled rows.
  - Markdown tables (Gmail-red headers, alternating-row banding, tabular numerals).
- **Stats card** for `calculateMeetingStats` — when expanded, the step body shows a 2x2 metric tile grid, a hours-based weekly load chart with each day color-coded by load level (free / light / medium / heavy / packed), and a collapsible day-by-day breakdown listing each meeting under its day.
- **Multi-meeting briefs** — each `# Meeting Title` becomes its own collapsible card; all collapsed by default.

## Setup

1. Clone this repo.
2. Get a Gemini API key from [aistudio.google.com](https://aistudio.google.com) (free tier available).
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the project folder.
4. Click the extension icon (Gmail-red envelope) in the toolbar.
5. Click the gear in the top-right of the popup.
6. Paste your Gemini API key (`AIza...`), click **Save**.
7. Click any quick-action button or type a custom query.

## File structure

```
session-3/
├── manifest.json       Extension config (MV3, host permission for generativelanguage.googleapis.com)
├── popup.html          UI layout
├── popup.js            UI controller, brief post-processor, markdown renderer
├── styles.css          All styles
├── agent.js            Agent loop (callLLM → handle tool_use → retry → loop)
├── api.js              Gemini API wrapper + Anthropic↔Gemini translation + system prompt + key storage
├── tools.js            5 tool definitions + dispatcher
├── mockData.js         Calendar / email / people / company fixtures
├── icons/              16/48/128 px Gmail-red envelope icons
└── README.md
```

## Tech stack

- Plain HTML / CSS / JavaScript (no framework, no build step)
- Chrome Extension Manifest V3
- Google Gemini Generative Language API — model `gemini-2.5-flash`
- `chrome.storage.local` for API key persistence

## Limitations

- **Single user, single device.** The API key sits in extension storage; not multi-tenant safe.
- **Mock data only.** No real calendar, email, or web access.
- **No conversation persistence.** Each popup session is independent; closing the popup loses history.
- **No streaming.** Each turn is a buffered POST / response cycle.
- **Direct browser API calls** to Google's Generative Language API. Acceptable for a single-user demo extension; do not ship to multiple users without a backend proxy that holds the API key.

## Future enhancements

### Short term

- **Real Google Calendar integration** via `chrome.identity` OAuth — unblocks the headline use case.
- **Real Gmail integration** via Gmail REST API + OAuth — replaces mock email search.
- **Real web search** — wire `searchWebInfo` to Tavily, Brave Search, or SerpAPI for company/person lookups beyond the fixed mock set.
- **Streaming responses** — switch to Server-Sent Events so reasoning prose shows token-by-token within a turn instead of per-turn.
- **Conversation persistence** — move the agent loop into a background service worker so long-running tasks survive popup close, and history can be resumed across popups.

### Medium term

- **Action tools, not just read tools** — `draftEmailReply`, `proposeMeetingTime`, `addToCalendar`, `bookFollowUp` — so the agent can act, not just inform.
- **Cross-meeting context** — surface email threads or shared attendees that span multiple upcoming meetings.
- **Pre-warming** — background fetch the next meeting and pre-compute a brief on a schedule so the popup opens with the brief already prepared.
- **More renderers in the brief** — inline email previews, attendee org-chart visualization, time-zone-aware meeting times.
- **Settings beyond the API key** — model picker (Gemini 2.5 Flash / Pro / Flash-Lite, plus optionally a non-Gemini provider via the API-boundary translator), iteration cap, default lookahead window, mock-vs-live toggle per tool.
- **Caching** — Gemini supports context caching for repeated long prefixes; apply it to the system prompt and tool declarations so repeated queries within a session pay the cached rate.
- **Provider abstraction** — formalize the `api.js` translation layer into a pluggable adapter so users can choose Gemini, Anthropic, OpenAI, etc. from settings without code changes.

### Longer term

- **MCP support** — re-introduce MCP as an *optional* path so users can plug in their own tool servers without modifying the extension. The earlier hybrid architecture (deleted) is preserved in git history.
- **Multi-turn refinement in-popup** — chat back and forth with the agent, not just one query → one brief.
- **Voice input** via Web Speech API — "what's next?" hands-free.
- **Native messaging host** for OS-level integrations (Outlook, Slack, Notion).
- **Distribution via Chrome Web Store** with a proxied API key path so users don't have to bring their own.
- **Evals** — a fixed set of meeting scenarios + golden briefs, run on CI to catch regressions when the model, tools, or system prompt change.
