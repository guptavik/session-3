// Mock + live MCP server for the Meeting Intelligence extension.
//
// Tools exposed:
//   getUpcomingMeetings  -> LIVE Google Calendar (after OAuth) with mock fallback off by default
//   searchGmail          -> mock (Gmail OAuth scope can be added later)
//   searchWebInfo        -> mock
//
// HTTP protocol (matches the extension's MCP client):
//   GET  /mcp/list_tools  -> { tools: [...] }
//   POST /mcp/call_tool   -> { content: [{ type: "text", text: "<json>" }] }
//
// OAuth routes (Google Calendar):
//   GET /oauth/start      -> 302 to Google consent
//   GET /oauth/callback   -> exchanges code, persists tokens.json
//   GET /oauth/status     -> { configured, authenticated, expires_at }

import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000", 10);
const TOKENS_FILE = path.join(__dirname, "tokens.json");
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Mock data (used by searchGmail / searchWebInfo) ----------

const NOW = new Date();

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
  "john.doe@acme.com":          { name: "John Doe",     currentRole: "VP of Engineering",  company: "Acme Corp",         background: "10 years at Acme, previously Senior SWE at Google Cloud.",            linkedInUrl: "https://linkedin.com/in/johndoe-acme" },
  "jane.smith@acme.com":        { name: "Jane Smith",   currentRole: "Director of Product", company: "Acme Corp",         background: "Joined Acme 3 years ago from Stripe. Owns billing and growth product.", linkedInUrl: "https://linkedin.com/in/janesmith-acme" },
  "mike.chen@globex.io":        { name: "Mike Chen",    currentRole: "Account Executive",   company: "Globex Logistics",  background: "Long-time AE at Globex, manages enterprise renewals.",                  linkedInUrl: "https://linkedin.com/in/mikechen-globex" },
  "bill.lumbergh@initech.com":  { name: "Bill Lumbergh",currentRole: "Director of Operations", company: "Initech",        background: "20+ years at Initech. Owns internal tooling and process automation.",  linkedInUrl: "https://linkedin.com/in/blumbergh" },
  "sarah.lee@ourcompany.com":   { name: "Sarah Lee",    currentRole: "Engineering Manager", company: "OurCompany",        background: "Internal — your direct report. Manages the platform team.",            linkedInUrl: null }
};

const MOCK_COMPANIES = {
  "acme corp":        { title: "Acme Corp - Company Profile",        snippet: "B2B SaaS company, ~500 employees. Recently raised $50M Series C led by Sequoia.", url: "https://acme.com/about",   linkedInCompanyUrl: "https://linkedin.com/company/acme-corp",       recentNews: ["Acme raises $50M Series C (TechCrunch)", "Acme launches SSO/SAML for Enterprise tier"] },
  "globex logistics": { title: "Globex Logistics - Company Profile", snippet: "Mid-market logistics SaaS, ~200 employees. Focus on shipment tracking and SLA reporting.", url: "https://globex.io/about",  linkedInCompanyUrl: "https://linkedin.com/company/globex-logistics", recentNews: ["Globex announces new datacenter in Frankfurt"] },
  "initech":          { title: "Initech - Company Profile",          snippet: "Mid-size enterprise (~1,200 employees) in financial services.",                          url: "https://initech.com/about",linkedInCompanyUrl: "https://linkedin.com/company/initech",         recentNews: ["Initech announces $5M digital transformation initiative"] }
};

// ---------- Google OAuth state ----------

let tokens = null; // { access_token, refresh_token, expires_at, scope, token_type }

async function loadTokens() {
  try {
    const data = await fs.readFile(TOKENS_FILE, "utf-8");
    tokens = JSON.parse(data);
    console.log("Loaded Google tokens from disk.");
  } catch {
    tokens = null;
  }
}

async function saveTokens(t) {
  tokens = t;
  await fs.writeFile(TOKENS_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

function isOauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function getValidAccessToken() {
  if (!tokens || !tokens.access_token) return null;

  // Refresh proactively if within 60s of expiry.
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60_000) {
    if (!tokens.refresh_token) return null;
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token"
      })
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Token refresh failed:", detail);
      return null;
    }
    const refreshed = await r.json();
    await saveTokens({
      ...tokens,
      access_token: refreshed.access_token,
      expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000
    });
  }
  return tokens.access_token;
}

// ---------- OAuth routes ----------

app.get("/oauth/start", (_req, res) => {
  if (!isOauthConfigured()) {
    return res.status(500).send(
      "<h1>OAuth not configured</h1>" +
      "<p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>mcp-server/.env</code>, " +
      "then restart the server. See <code>mcp-server/SETUP-GOOGLE.md</code>.</p>"
    );
  }
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  res.redirect(url);
});

app.get("/oauth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<h1>OAuth error</h1><p>${error}</p>`);
  }
  if (!code) {
    return res.status(400).send("<h1>Missing 'code' parameter</h1>");
  }
  if (!isOauthConfigured()) {
    return res.status(500).send("<h1>OAuth not configured</h1>");
  }

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).send(`<h1>Token exchange failed</h1><pre>${detail}</pre>`);
    }

    const tok = await r.json();
    await saveTokens({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || tokens?.refresh_token || null,
      token_type: tok.token_type,
      scope: tok.scope,
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000
    });

    res.send(
      "<h1>Connected to Google Calendar</h1>" +
      "<p>You can close this tab and return to the extension popup.</p>" +
      "<p>If the popup doesn't show 'connected', reopen it (click the extension icon again).</p>"
    );
  } catch (err) {
    res.status(500).send(`<h1>OAuth callback error</h1><pre>${err.message}</pre>`);
  }
});

app.get("/oauth/status", (_req, res) => {
  res.json({
    configured: isOauthConfigured(),
    authenticated: Boolean(tokens && tokens.access_token),
    expires_at: tokens?.expires_at || null
  });
});

// ---------- Tool definitions exposed to MCP clients ----------

const TOOL_DEFS = [
  {
    name: "getUpcomingMeetings",
    description:
      "Fetches the user's REAL upcoming meetings from their Google Calendar within a time window. " +
      "Use first when the user asks about meetings, schedule, or wants to prepare for upcoming events. " +
      "Requires the MCP server to be authenticated with Google Calendar (OAuth).",
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
      "Currently returns mock data; will switch to live Gmail when Gmail OAuth scope is added.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text keywords." },
        maxResults: { type: "number", description: "Max results. Default 5." }
      },
      required: ["query"]
    }
  },
  {
    name: "searchWebInfo",
    description:
      "Mock web lookup for a company or person. Returns a profile (role, background, LinkedIn URL when " +
      "available) for people, or a company snippet plus recent news for companies. " +
      "LinkedIn data is preferred when available.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Company name, person name, or email." },
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

async function getUpcomingMeetings({ hoursAhead = 24 } = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error(
      "Google Calendar is not connected on the MCP server. " +
      `Visit ${REDIRECT_URI.replace("/oauth/callback", "/oauth/start")} to authorize, then retry.`
    );
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 3600 * 1000);
  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: cutoff.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20"
  });

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Google Calendar API ${r.status}: ${detail.slice(0, 500)}`);
  }
  const data = await r.json();

  return (data.items || [])
    .filter(ev => ev.start && (ev.start.dateTime || ev.start.date))
    .map(ev => ({
      id: ev.id,
      title: ev.summary || "(no title)",
      startTime: ev.start.dateTime || ev.start.date,
      endTime: ev.end?.dateTime || ev.end?.date || ev.start.dateTime || ev.start.date,
      attendees: (ev.attendees || []).map(a => a.email).filter(Boolean),
      location: ev.location || "",
      description: ev.description || "",
      htmlLink: ev.htmlLink || null,
      organizerEmail: ev.organizer?.email || null
    }));
}

function searchGmail({ query, maxResults = 5 }) {
  if (!query || typeof query !== "string") {
    throw new Error("searchGmail requires a non-empty string 'query'.");
  }
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return MOCK_EMAILS
    .map(e => {
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
      title: c.title, snippet: c.snippet, url: c.url,
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
      name: p.name, currentRole: p.currentRole, company: p.company,
      background: p.background,
      url: p.linkedInUrl, linkedInUrl: p.linkedInUrl,
      source: p.linkedInUrl ? "linkedin" : "web",
      recentNews: []
    }];
  };

  let results = [];
  if (searchType === "company") results = lookupCompany(query);
  else if (searchType === "person") results = lookupPerson(query);
  else results = [...lookupPerson(query), ...lookupCompany(query)];

  if (!results.length) {
    return [{
      title: `${query} - no profile found`,
      snippet: `No information available for "${query}" in this mock dataset.`,
      url: null, linkedInUrl: null, source: "none", recentNews: []
    }];
  }
  return results;
}

// ---------- HTTP layer ----------

app.get("/mcp/list_tools", (_req, res) => {
  res.json({ tools: TOOL_DEFS });
});

app.post("/mcp/call_tool", async (req, res) => {
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
        result = await getUpcomingMeetings(args || {});
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
    res.json({ content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    res.status(500).json({
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true
    });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- Start ----------

await loadTokens();
app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log(`Tools: ${TOOL_DEFS.map(t => t.name).join(", ")}`);
  console.log(`OAuth configured: ${isOauthConfigured()}`);
  console.log(`Google authenticated: ${Boolean(tokens && tokens.access_token)}`);
  if (isOauthConfigured() && !(tokens && tokens.access_token)) {
    console.log(`To connect Google Calendar: open http://localhost:${PORT}/oauth/start in a browser.`);
  }
});
