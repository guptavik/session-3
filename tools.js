// Tool definitions (JSON schemas Claude sees) and implementations.
// Implementations read from mockData.js (loaded as a script in popup.html).

const TOOLS = [
  {
    name: "getUpcomingMeetings",
    description:
      "Fetches the user's upcoming meetings from their calendar within a time window. " +
      "Use this first when the user asks about meetings, schedule, or wants to prepare for upcoming events.",
    input_schema: {
      type: "object",
      properties: {
        hoursAhead: {
          type: "number",
          description: "How many hours ahead to look. Default 24."
        }
      },
      required: []
    }
  },
  {
    name: "searchGmail",
    description:
      "Searches the user's email for messages matching a query. " +
      "Use this to find prior context (threads, attachments, prior commitments) about a meeting, person, or company.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search keywords (e.g. company name, person name, project)."
        },
        maxResults: {
          type: "number",
          description: "Max number of email snippets to return. Default 5."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "searchWebInfo",
    description:
      "Searches the web for public information about a company or a person. " +
      "Use this to gather background, recent news, funding, or product context that is NOT in the user's email/calendar.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for (e.g. company name)."
        },
        type: {
          type: "string",
          enum: ["company", "person"],
          description: "Whether the query targets a company or a person."
        }
      },
      required: ["query", "type"]
    }
  },
  {
    name: "analyzeAttendeeBackground",
    description:
      "Looks up the professional background of a meeting attendee (role, company, work history). " +
      "Use this once you know who is attending a meeting and want a quick profile.",
    input_schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email address of the attendee."
        }
      },
      required: ["email"]
    }
  },
  {
    name: "calculateMeetingStats",
    description:
      "Computes statistics over a list of meeting objects (total count, total hours, busiest day, distribution). " +
      "Use this when the user asks about meeting load, busiest day, or schedule analysis. " +
      "Pass meetings exactly as returned by getUpcomingMeetings.",
    input_schema: {
      type: "object",
      properties: {
        meetings: {
          type: "array",
          description: "Array of meeting objects with startTime and endTime ISO strings.",
          items: { type: "object" }
        },
        timeframe: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Optional human-readable label for the report."
        }
      },
      required: ["meetings"]
    }
  }
];

// ---------- Implementations ----------

function getUpcomingMeetings({ hoursAhead = 24 } = {}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 3600 * 1000);
  return MOCK_MEETINGS
    .filter(m => {
      const start = new Date(m.startTime);
      return start >= now && start <= cutoff;
    })
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

function searchGmail({ query, maxResults = 5 }) {
  if (!query || typeof query !== "string") {
    throw new Error("searchGmail requires a non-empty string 'query'.");
  }
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = MOCK_EMAILS.map(e => {
    const haystack = [
      e.subject,
      e.from,
      e.snippet,
      ...(e.keywords || [])
    ].join(" ").toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
    return { email: e, score };
  })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => ({
      subject: s.email.subject,
      from: s.email.from,
      date: s.email.date,
      snippet: s.email.snippet
    }));
  return scored;
}

function searchWebInfo({ query, type }) {
  if (!query || !type) {
    throw new Error("searchWebInfo requires 'query' and 'type'.");
  }
  if (type === "company") {
    const key = query.toLowerCase().trim();
    const matches = [];
    if (MOCK_COMPANIES[key]) {
      matches.push(MOCK_COMPANIES[key]);
    } else {
      for (const [k, v] of Object.entries(MOCK_COMPANIES)) {
        if (k.includes(key) || key.includes(k)) matches.push(v);
      }
    }
    if (matches.length) {
      return matches.map(c => ({
        title: c.title,
        snippet: c.snippet,
        url: c.url,
        linkedInUrl: c.linkedInCompanyUrl || null,
        source: c.linkedInCompanyUrl ? "linkedin" : "web",
        recentNews: c.recentNews || []
      }));
    }
    return [{
      title: `${query} - no profile found`,
      snippet: `No information available for "${query}" in this mock dataset.`,
      url: null,
      linkedInUrl: null,
      source: "none",
      recentNews: []
    }];
  }
  if (type === "person") {
    const lower = query.toLowerCase().trim();
    // Match by name or by email key.
    const match = Object.entries(MOCK_PEOPLE).find(([email, p]) =>
      p.name.toLowerCase().includes(lower) || email.toLowerCase().includes(lower)
    );
    if (match) {
      const [, p] = match;
      // Prefer LinkedIn as the source-of-truth profile when we have a URL.
      return [{
        title: `${p.name} - ${p.currentRole} at ${p.company}`,
        snippet: p.background,
        url: p.linkedInUrl,
        linkedInUrl: p.linkedInUrl,
        source: p.linkedInUrl ? "linkedin" : "web",
        recentNews: []
      }];
    }
    return [{
      title: `${query} - no profile found`,
      snippet: `No information available for "${query}".`,
      url: null,
      linkedInUrl: null,
      source: "none",
      recentNews: []
    }];
  }
  throw new Error(`Unknown search type: ${type}`);
}

function analyzeAttendeeBackground({ email }) {
  if (!email) throw new Error("analyzeAttendeeBackground requires 'email'.");
  const profile = MOCK_PEOPLE[email.toLowerCase()];
  if (profile) return profile;
  // Synthesize a stub for unknown attendees so the agent isn't blocked.
  const domain = email.split("@")[1] || "unknown";
  const localPart = (email.split("@")[0] || email).replace(/\./g, " ");
  return {
    name: localPart.replace(/\b\w/g, c => c.toUpperCase()),
    currentRole: "Unknown",
    company: domain.split(".")[0].replace(/\b\w/g, c => c.toUpperCase()),
    background: `No detailed profile on file for ${email}.`,
    linkedInUrl: null
  };
}

function calculateMeetingStats({ meetings, timeframe }) {
  if (!Array.isArray(meetings)) {
    throw new Error("calculateMeetingStats requires 'meetings' to be an array.");
  }
  if (meetings.length === 0) {
    return {
      timeframe: timeframe || "n/a",
      totalMeetings: 0,
      totalHours: 0,
      averageDurationHours: 0,
      busiestDay: null,
      meetingDistribution: {}
    };
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dist = {};
  let totalMs = 0;
  for (const m of meetings) {
    const start = new Date(m.startTime);
    const end = new Date(m.endTime);
    const dur = end - start;
    if (Number.isFinite(dur) && dur > 0) totalMs += dur;
    const day = days[start.getDay()];
    dist[day] = (dist[day] || 0) + 1;
  }
  const totalHours = +(totalMs / 3600000).toFixed(2);
  const averageDurationHours = +(totalHours / meetings.length).toFixed(2);
  const busiestDay = Object.entries(dist).sort((a, b) => b[1] - a[1])[0][0];
  return {
    timeframe: timeframe || "n/a",
    totalMeetings: meetings.length,
    totalHours,
    averageDurationHours,
    busiestDay,
    meetingDistribution: dist
  };
}

// ---------- Dispatcher ----------

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "getUpcomingMeetings":       return getUpcomingMeetings(toolInput || {});
    case "searchGmail":               return searchGmail(toolInput || {});
    case "searchWebInfo":             return searchWebInfo(toolInput || {});
    case "analyzeAttendeeBackground": return analyzeAttendeeBackground(toolInput || {});
    case "calculateMeetingStats":     return calculateMeetingStats(toolInput || {});
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TOOLS, executeTool };
}
