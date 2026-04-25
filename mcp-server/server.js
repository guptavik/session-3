// Mock MCP server. Exposes 3 tools over a simple HTTP protocol:
//   GET  /mcp/list_tools       -> { tools: [...] }
//   POST /mcp/call_tool        -> { content: [{ type: "text", text: <JSON-string> }] }
//
// The Chrome extension acts as the MCP client: on each agent run it fetches
// the tool list and merges it with its local tools when calling Claude.

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Mock data (anchored to "now" so the demo always has fresh meetings) ----------

const NOW = new Date();
const inHours = h => {
  const d = new Date(NOW);
  d.setHours(d.getHours() + h, 0, 0, 0);
  return d.toISOString();
};
const addMinutes = (iso, m) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + m);
  return d.toISOString();
};

const MOCK_MEETINGS = [
  {
    id: "mtg_001",
    title: "Product Demo with Acme Corp",
    startTime: inHours(2),
    endTime: addMinutes(inHours(2), 60),
    attendees: ["john.doe@acme.com", "jane.smith@acme.com"],
    location: "Zoom",
    description: "Discuss Q1 roadmap and Enterprise pricing tier."
  },
  {
    id: "mtg_002",
    title: "1:1 with Sarah",
    startTime: inHours(5),
    endTime: addMinutes(inHours(5), 30),
    attendees: ["sarah.lee@ourcompany.com"],
    location: "Office - Room 4B",
    description: "Weekly sync."
  },
  {
    id: "mtg_003",
    title: "Vendor Review - Globex Logistics",
    startTime: inHours(24),
    endTime: addMinutes(inHours(24), 45),
    attendees: ["mike.chen@globex.io", "procurement@ourcompany.com"],
    location: "Google Meet",
    description: "Review SLA performance and renewal terms for Globex contract."
  },
  {
    id: "mtg_004",
    title: "Engineering Planning",
    startTime: inHours(28),
    endTime: addMinutes(inHours(28), 90),
    attendees: ["eng-leads@ourcompany.com"],
    location: "Zoom",
    description: "Q2 roadmap planning."
  },
  {
    id: "mtg_005",
    title: "Intro Call - Initech",
    startTime: inHours(48),
    endTime: addMinutes(inHours(48), 30),
    attendees: ["bill.lumbergh@initech.com"],
    location: "Zoom",
    description: "Initial discovery call about workflow automation needs."
  },
  {
    id: "mtg_006",
    title: "Board Update Prep",
    startTime: inHours(72),
    endTime: addMinutes(inHours(72), 60),
    attendees: ["ceo@ourcompany.com", "cfo@ourcompany.com"],
    location: "Office - Boardroom",
    description: "Prep for Friday board meeting."
  }
];

const MOCK_EMAILS = [
  {
    id: "email_001",
    subject: "Re: Product Demo Preparation",
    from: "john.doe@acme.com",
    to: "you@ourcompany.com",
    date: new Date(NOW.getTime() - 5 * 86400000).toISOString().slice(0, 10),
    snippet: "Looking forward to the demo. Our team is most interested in the pricing tiers and SSO support. Jane will join from product side.",
    keywords: ["acme", "demo", "pricing", "sso"]
  },
  {
    id: "email_002",
    subject: "Acme Corp - Pricing Questions",
    from: "jane.smith@acme.com",
    to: "you@ourcompany.com",
    date: new Date(NOW.getTime() - 3 * 86400000).toISOString().slice(0, 10),
    snippet: "Can you walk us through the Enterprise tier? We have 500 seats and need SAML.",
    keywords: ["acme", "pricing", "enterprise", "saml"]
  },
  {
    id: "email_003",
    subject: "Globex SLA - Q4 numbers",
    from: "mike.chen@globex.io",
    to: "procurement@ourcompany.com",
    date: new Date(NOW.getTime() - 7 * 86400000).toISOString().slice(0, 10),
    snippet: "Attaching the Q4 SLA report. We hit 99.7% uptime, slightly below the 99.9% target. Happy to discuss.",
    keywords: ["globex", "sla", "uptime", "vendor"]
  },
  {
    id: "email_004",
    subject: "Initech intro - context",
    from: "referral@partner.com",
    to: "you@ourcompany.com",
    date: new Date(NOW.getTime() - 2 * 86400000).toISOString().slice(0, 10),
    snippet: "Connecting you with Bill at Initech. They are evaluating workflow automation tools and have a $200k budget.",
    keywords: ["initech", "workflow", "automation", "intro"]
  },
  {
    id: "email_005",
    subject: "Board deck draft",
    from: "cfo@ourcompany.com",
    to: "you@ourcompany.com",
    date: new Date(NOW.getTime() - 1 * 86400000).toISOString().slice(0, 10),
    snippet: "Draft of the board deck attached. Please review the revenue slides before our prep call.",
    keywords: ["board", "deck", "revenue"]
  }
];

const MOCK_PEOPLE = {
  "john.doe@acme.com": {
    name: "John Doe",
    currentRole: "VP of Engineering",
    company: "Acme Corp",
    background: "10 years at Acme, previously Senior SWE at Google Cloud. Leads infra and platform teams.",
    linkedInUrl: "https://linkedin.com/in/johndoe-acme"
  },
  "jane.smith@acme.com": {
    name: "Jane Smith",
    currentRole: "Director of Product",
    company: "Acme Corp",
    background: "Joined Acme 3 years ago from Stripe. Owns billing and growth product surface.",
    linkedInUrl: "https://linkedin.com/in/janesmith-acme"
  },
  "mike.chen@globex.io": {
    name: "Mike Chen",
    currentRole: "Account Executive",
    company: "Globex Logistics",
    background: "Long-time AE at Globex, manages enterprise renewals.",
    linkedInUrl: "https://linkedin.com/in/mikechen-globex"
  },
  "bill.lumbergh@initech.com": {
    name: "Bill Lumbergh",
    currentRole: "Director of Operations",
    company: "Initech",
    background: "20+ years at Initech. Owns internal tooling and process automation initiatives.",
    linkedInUrl: "https://linkedin.com/in/blumbergh"
  },
  "sarah.lee@ourcompany.com": {
    name: "Sarah Lee",
    currentRole: "Engineering Manager",
    company: "OurCompany",
    background: "Internal — your direct report. Manages the platform team.",
    linkedInUrl: null
  }
};

const MOCK_COMPANIES = {
  "acme corp": {
    title: "Acme Corp - Company Profile",
    snippet: "B2B SaaS company, ~500 employees. Recently raised $50M Series C led by Sequoia. Known for workflow automation and a strong enterprise customer base.",
    url: "https://acme.com/about",
    linkedInCompanyUrl: "https://linkedin.com/company/acme-corp",
    recentNews: [
      "Acme raises $50M Series C (TechCrunch, last month)",
      "Acme launches SSO/SAML for Enterprise tier (Acme blog, 2 weeks ago)"
    ]
  },
  "globex logistics": {
    title: "Globex Logistics - Company Profile",
    snippet: "Mid-market logistics SaaS, ~200 employees. Focus on shipment tracking and SLA reporting. Q3 had reliability issues per industry reports.",
    url: "https://globex.io/about",
    linkedInCompanyUrl: "https://linkedin.com/company/globex-logistics",
    recentNews: [
      "Globex announces new datacenter in Frankfurt (Globex blog, last quarter)"
    ]
  },
  "initech": {
    title: "Initech - Company Profile",
    snippet: "Mid-size enterprise (~1,200 employees) in financial services. Heavy on legacy mainframe systems, currently modernizing internal workflows.",
    url: "https://initech.com/about",
    linkedInCompanyUrl: "https://linkedin.com/company/initech",
    recentNews: [
      "Initech announces $5M digital transformation initiative (PR Newswire, 6 weeks ago)"
    ]
  }
};

// ---------- Tool definitions exposed to MCP clients ----------

const TOOL_DEFS = [
  {
    name: "getUpcomingMeetings",
    description:
      "Fetches the user's upcoming meetings from their calendar within a time window. " +
      "Use first when the user asks about meetings, schedule, or wants to prepare for upcoming events.",
    inputSchema: {
      type: "object",
      properties: {
        hoursAhead: {
          type: "number",
          description: "How many hours ahead to look. Default 24."
        }
      }
    }
  },
  {
    name: "searchGmail",
    description:
      "Searches the user's email for messages matching a free-text query. " +
      "Use this to find prior context (threads, commitments, attachments) about a meeting, person, or company.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text keywords (e.g. company name, person name, project)."
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
      "Searches the web for information about a company or a person. " +
      "Returns a profile (role, background, LinkedIn URL when available) for people, " +
      "or a company snippet plus recent news for companies. " +
      "LinkedIn data is preferred when available.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for (company name, person name, or email)."
        },
        searchType: {
          type: "string",
          enum: ["company", "person", "general"],
          description: "Whether the query targets a company, a person, or a general lookup."
        }
      },
      required: ["query"]
    }
  }
];

// ---------- Tool implementations ----------

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
  return MOCK_EMAILS.map(e => {
    const haystack = [e.subject, e.from, e.snippet, ...(e.keywords || [])]
      .join(" ").toLowerCase();
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
}

function searchWebInfo({ query, searchType = "general" }) {
  if (!query) throw new Error("searchWebInfo requires 'query'.");

  const lookupCompany = (q) => {
    const key = q.toLowerCase().trim();
    const matches = [];
    if (MOCK_COMPANIES[key]) {
      matches.push(MOCK_COMPANIES[key]);
    } else {
      for (const [k, v] of Object.entries(MOCK_COMPANIES)) {
        if (k.includes(key) || key.includes(k)) matches.push(v);
      }
    }
    return matches.map(c => ({
      title: c.title,
      snippet: c.snippet,
      url: c.url,
      linkedInUrl: c.linkedInCompanyUrl || null,
      source: c.linkedInCompanyUrl ? "linkedin" : "web",
      recentNews: c.recentNews || []
    }));
  };

  const lookupPerson = (q) => {
    const lower = q.toLowerCase().trim();
    const match = Object.entries(MOCK_PEOPLE).find(([email, p]) =>
      p.name.toLowerCase().includes(lower) || email.toLowerCase().includes(lower)
    );
    if (!match) return [];
    const [, p] = match;
    return [{
      title: `${p.name} - ${p.currentRole} at ${p.company}`,
      name: p.name,
      currentRole: p.currentRole,
      company: p.company,
      background: p.background,
      url: p.linkedInUrl,
      linkedInUrl: p.linkedInUrl,
      source: p.linkedInUrl ? "linkedin" : "web",
      recentNews: []
    }];
  };

  let results = [];
  if (searchType === "company") {
    results = lookupCompany(query);
  } else if (searchType === "person") {
    results = lookupPerson(query);
  } else {
    // general: try both, prefer person hits
    results = [...lookupPerson(query), ...lookupCompany(query)];
  }

  if (!results.length) {
    return [{
      title: `${query} - no profile found`,
      snippet: `No information available for "${query}" in this mock dataset.`,
      url: null,
      linkedInUrl: null,
      source: "none",
      recentNews: []
    }];
  }
  return results;
}

// ---------- HTTP layer ----------

app.get("/mcp/list_tools", (_req, res) => {
  res.json({ tools: TOOL_DEFS });
});

app.post("/mcp/call_tool", (req, res) => {
  const { name, arguments: args } = req.body || {};
  if (!name) {
    return res.status(400).json({
      content: [{ type: "text", text: JSON.stringify({ error: "Missing 'name'" }) }],
      isError: true
    });
  }

  try {
    let result;
    switch (name) {
      case "getUpcomingMeetings":
        result = getUpcomingMeetings(args || {});
        break;
      case "searchGmail":
        result = searchGmail(args || {});
        break;
      case "searchWebInfo":
        result = searchWebInfo(args || {});
        break;
      default:
        return res.status(404).json({
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true
        });
    }
    res.json({
      content: [{ type: "text", text: JSON.stringify(result) }]
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    res.status(500).json({
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true
    });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log(`Tools: ${TOOL_DEFS.map(t => t.name).join(", ")}`);
});
