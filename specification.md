# **Meeting Intelligence Agent - Hybrid Architecture**

## **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Frontend UI (popup.html + popup.js)               │    │
│  │  - User input                                       │    │
│  │  - Reasoning chain display                         │    │
│  │  - API key management                              │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                         │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  Local Tools (tools.js)                            │    │
│  │  - calculateMeetingStats() [MATH/CALCULATIONS]     │    │
│  │  - formatMeetingBrief() [DATA FORMATTING]          │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Calls Claude API with:
                   │ - Local tools (defined in extension)
                   │ - MCP server URL (for external tools)
                   │
                   ▼
        ┌──────────────────────────┐
        │   Anthropic Claude API   │
        │    (Agent Orchestrator)  │
        └────┬──────────────┬──────┘
             │              │
    ┌────────▼─────┐   ┌────▼────────────────┐
    │ Local Tools  │   │   MCP Server        │
    │ (in extension)│   │ (localhost:3000)    │
    └──────────────┘   └─────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
            ┌───────▼────────┐  ┌────────▼──────────┐
            │ getUpcoming    │  │ searchGmail       │
            │ Meetings       │  │                   │
            │ [EXTERNAL API] │  │ [EXTERNAL API]    │
            └────────────────┘  └───────────────────┘
                    │
            ┌───────▼────────┐
            │ searchWebInfo  │
            │ [WEB SCRAPING] │
            └────────────────┘
```

---

## **Tool Distribution Strategy**

### **MCP Server Tools (3 tools)** - External Data Access
These require external APIs, network calls, or heavy processing:

1. **`getUpcomingMeetings`** - Mock Google Calendar API
2. **`searchGmail`** - Mock Gmail search
3. **`searchWebInfo`** - Real web scraping/search

### **Local Extension Tools (2 tools)** - Calculations & Formatting
These are pure functions that don't need external services:

4. **`calculateMeetingStats`** - Math calculations on meeting data
5. **`formatMeetingBrief`** - Data transformation/formatting

---

## **Detailed Tool Specs**

### **MCP Server Tools**

#### **Tool 1: `getUpcomingMeetings`** (MCP)
```json
{
  "name": "getUpcomingMeetings",
  "description": "Fetches upcoming meetings from user's calendar",
  "inputSchema": {
    "type": "object",
    "properties": {
      "hoursAhead": {
        "type": "number",
        "description": "Number of hours to look ahead (default: 24)"
      }
    }
  }
}
```

**Why MCP?** Simulates external calendar API access

**Implementation:** Returns mock meeting data from MCP server

---

#### **Tool 2: `searchGmail`** (MCP)
```json
{
  "name": "searchGmail",
  "description": "Searches user's Gmail for emails matching query",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search keywords (e.g., 'Acme Corp pricing')"
      },
      "maxResults": {
        "type": "number",
        "description": "Maximum number of results (default: 5)"
      }
    },
    "required": ["query"]
  }
}
```

**Why MCP?** Simulates external email API access

**Implementation:** Returns mock email threads from MCP server

---

#### **Tool 3: `searchWebInfo`** (MCP)
```json
{
  "name": "searchWebInfo",
  "description": "Searches the web for company or person information",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "What to search for"
      },
      "searchType": {
        "type": "string",
        "enum": ["company", "person", "general"],
        "description": "Type of search"
      }
    },
    "required": ["query"]
  }
}
```

**Why MCP?** Real web scraping/API calls

**Implementation:** Could use DuckDuckGo API or mock data

---

### **Local Extension Tools**

#### **Tool 4: `calculateMeetingStats`** (Local)
```json
{
  "name": "calculateMeetingStats",
  "description": "Calculates statistics about meetings (total time, distribution, etc.)",
  "input_schema": {
    "type": "object",
    "properties": {
      "meetings": {
        "type": "array",
        "description": "Array of meeting objects"
      },
      "timeframe": {
        "type": "string",
        "enum": ["today", "week", "month"],
        "description": "Timeframe to analyze"
      }
    },
    "required": ["meetings"]
  }
}
```

**Why Local?** Pure calculation, no external dependencies

**Implementation:**
```javascript
function calculateMeetingStats(meetings, timeframe) {
  const totalMeetings = meetings.length;
  const totalMinutes = meetings.reduce((sum, m) => {
    const duration = (new Date(m.endTime) - new Date(m.startTime)) / 60000;
    return sum + duration;
  }, 0);
  
  const totalHours = totalMinutes / 60;
  const avgDuration = totalMinutes / totalMeetings;
  
  // Calculate busiest day
  const dayCount = {};
  meetings.forEach(m => {
    const day = new Date(m.startTime).toLocaleDateString('en-US', { weekday: 'long' });
    dayCount[day] = (dayCount[day] || 0) + 1;
  });
  
  const busiestDay = Object.keys(dayCount).reduce((a, b) => 
    dayCount[a] > dayCount[b] ? a : b
  );
  
  return {
    totalMeetings,
    totalHours: totalHours.toFixed(2),
    averageDuration: avgDuration.toFixed(0),
    busiestDay,
    meetingDistribution: dayCount
  };
}
```

---

#### **Tool 5: `formatMeetingBrief`** (Local)
```json
{
  "name": "formatMeetingBrief",
  "description": "Formats collected meeting data into a structured brief",
  "input_schema": {
    "type": "object",
    "properties": {
      "meetingData": {
        "type": "object",
        "description": "Raw meeting information"
      },
      "attendeeInfo": {
        "type": "array",
        "description": "Attendee background information"
      },
      "emailContext": {
        "type": "array",
        "description": "Related email threads"
      }
    },
    "required": ["meetingData"]
  }
}
```

**Why Local?** Pure data transformation

**Implementation:**
```javascript
function formatMeetingBrief(meetingData, attendeeInfo = [], emailContext = []) {
  return {
    meetingTitle: meetingData.title,
    scheduledTime: new Date(meetingData.startTime).toLocaleString(),
    duration: `${(new Date(meetingData.endTime) - new Date(meetingData.startTime)) / 60000} minutes`,
    attendees: attendeeInfo.map(a => ({
      name: a.name,
      role: a.currentRole,
      company: a.company
    })),
    recentEmails: emailContext.map(e => ({
      subject: e.subject,
      date: e.date,
      summary: e.snippet
    })),
    preparationChecklist: [
      "Review attendee backgrounds",
      "Prepare demo environment",
      "Review recent email threads",
      "Prepare questions based on context"
    ]
  };
}
```

---

## **MCP Server Implementation**

### **File: `mcp-server/server.js`**

```javascript
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Mock data
const MOCK_MEETINGS = [
  {
    id: "meeting_1",
    title: "Product Demo with Acme Corp",
    startTime: "2024-01-15T14:00:00Z",
    endTime: "2024-01-15T15:00:00Z",
    attendees: ["john.doe@acme.com", "jane.smith@acme.com"],
    location: "Zoom",
    description: "Discuss Q1 roadmap and pricing options"
  },
  {
    id: "meeting_2",
    title: "Weekly Team Sync",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T10:30:00Z",
    attendees: ["team@company.com"],
    location: "Conference Room A",
    description: "Sprint planning and blockers"
  }
];

const MOCK_EMAILS = [
  {
    id: "email_1",
    subject: "Re: Product Demo Preparation",
    from: "john.doe@acme.com",
    date: "2024-01-10",
    snippet: "Looking forward to the demo. Particularly interested in the enterprise pricing tier and API integration capabilities."
  },
  {
    id: "email_2",
    subject: "Acme Corp - Follow up questions",
    from: "jane.smith@acme.com",
    date: "2024-01-12",
    snippet: "Can you provide case studies from similar companies in the fintech space?"
  }
];

// MCP Protocol: List available tools
app.get('/mcp/list_tools', (req, res) => {
  res.json({
    tools: [
      {
        name: "getUpcomingMeetings",
        description: "Fetches upcoming meetings from user's calendar",
        inputSchema: {
          type: "object",
          properties: {
            hoursAhead: {
              type: "number",
              description: "Number of hours to look ahead (default: 24)"
            }
          }
        }
      },
      {
        name: "searchGmail",
        description: "Searches user's Gmail for emails matching query",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords" },
            maxResults: { type: "number", description: "Max results (default: 5)" }
          },
          required: ["query"]
        }
      },
      {
        name: "searchWebInfo",
        description: "Searches the web for company or person information",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for" },
            searchType: {
              type: "string",
              enum: ["company", "person", "general"]
            }
          },
          required: ["query"]
        }
      }
    ]
  });
});

// MCP Protocol: Call a tool
app.post('/mcp/call_tool', (req, res) => {
  const { name, arguments: args } = req.body;
  
  switch(name) {
    case "getUpcomingMeetings":
      const hoursAhead = args.hoursAhead || 24;
      const cutoffTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
      const upcomingMeetings = MOCK_MEETINGS.filter(m => 
        new Date(m.startTime) <= cutoffTime
      );
      res.json({ content: [{ type: "text", text: JSON.stringify(upcomingMeetings, null, 2) }] });
      break;
      
    case "searchGmail":
      const query = args.query.toLowerCase();
      const maxResults = args.maxResults || 5;
      const matchingEmails = MOCK_EMAILS.filter(e =>
        e.subject.toLowerCase().includes(query) ||
        e.snippet.toLowerCase().includes(query) ||
        e.from.toLowerCase().includes(query)
      ).slice(0, maxResults);
      res.json({ content: [{ type: "text", text: JSON.stringify(matchingEmails, null, 2) }] });
      break;
      
    case "searchWebInfo":
      // Mock web search results
      const searchResults = [
        {
          title: "Acme Corp - Company Profile",
          snippet: "B2B SaaS company specializing in enterprise solutions. 500+ employees, recently raised $50M Series B funding.",
          url: "https://acme.com/about"
        },
        {
          title: "Acme Corp News - Tech Crunch",
          snippet: "Acme Corp announces new AI-powered features and expansion into European markets.",
          url: "https://techcrunch.com/acme-news"
        }
      ];
      res.json({ content: [{ type: "text", text: JSON.stringify(searchResults, null, 2) }] });
      break;
      
    default:
      res.status(404).json({ error: "Tool not found" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on http://localhost:${PORT}`);
  console.log(`📡 Tools available: getUpcomingMeetings, searchGmail, searchWebInfo`);
});
```

### **File: `mcp-server/package.json`**
```json
{
  "name": "meeting-intelligence-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "scripts": {
    "start": "node server.js"
  }
}
```

---

## **Chrome Extension Implementation**

### **File: `manifest.json`**
```json
{
  "manifest_version": 3,
  "name": "Meeting Intelligence Agent",
  "version": "1.0.0",
  "description": "Agentic AI assistant for meeting preparation",
  "permissions": ["storage"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

### **File: `popup.html`**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Meeting Intelligence Agent</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Meeting Intelligence Agent</h1>
      <p class="subtitle">Hybrid Architecture: MCP + Local Tools</p>
    </header>

    <section class="config-section">
      <label for="apiKey">Claude API Key:</label>
      <input type="password" id="apiKey" placeholder="sk-ant-...">
      <button id="saveKey">Save</button>
      <span id="keyStatus"></span>
    </section>

    <section class="query-section">
      <h3>What would you like help with?</h3>
      <div class="quick-actions">
        <button class="action-btn" data-query="Prepare me for my next meeting">
          📅 Next Meeting
        </button>
        <button class="action-btn" data-query="Show all my meetings today">
          📊 Today's Schedule
        </button>
        <button class="action-btn" data-query="Calculate my meeting statistics for this week">
          📈 Meeting Stats
        </button>
      </div>
      
      <div class="custom-query">
        <input type="text" id="customQuery" placeholder="Or type your own query...">
        <button id="runQuery">Go</button>
      </div>
    </section>

    <section class="reasoning-section" id="reasoningSection" style="display: none;">
      <h3>🔄 Agent Reasoning Chain</h3>
      <div id="reasoningSteps"></div>
    </section>

    <section class="result-section" id="resultSection" style="display: none;">
      <h3>📄 Final Result</h3>
      <div id="finalResult"></div>
    </section>
  </div>

  <script src="tools.js"></script>
  <script src="api.js"></script>
  <script src="agent.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

---

### **File: `tools.js`** (Local Tools)
```javascript
// Local tool definitions (these run in the extension)
const LOCAL_TOOLS = [
  {
    name: "calculateMeetingStats",
    description: "Calculates statistics about meetings (total time, distribution, busiest day)",
    input_schema: {
      type: "object",
      properties: {
        meetings: {
          type: "array",
          description: "Array of meeting objects with startTime and endTime"
        },
        timeframe: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Timeframe to analyze"
        }
      },
      required: ["meetings"]
    }
  },
  {
    name: "formatMeetingBrief",
    description: "Formats collected meeting data into a structured brief with preparation tips",
    input_schema: {
      type: "object",
      properties: {
        meetingData: {
          type: "object",
          description: "Meeting information (title, time, attendees, description)"
        },
        attendeeInfo: {
          type: "array",
          description: "Optional attendee background information"
        },
        emailContext: {
          type: "array",
          description: "Optional related email threads"
        }
      },
      required: ["meetingData"]
    }
  }
];

// Local tool implementations
function calculateMeetingStats(meetings, timeframe = "week") {
  const totalMeetings = meetings.length;
  
  let totalMinutes = 0;
  const dayCount = {};
  
  meetings.forEach(meeting => {
    // Calculate duration
    const start = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    const duration = (end - start) / 60000; // minutes
    totalMinutes += duration;
    
    // Count by day
    const day = start.toLocaleDateString('en-US', { weekday: 'long' });
    dayCount[day] = (dayCount[day] || 0) + 1;
  });
  
  const totalHours = totalMinutes / 60;
  const avgDuration = totalMeetings > 0 ? totalMinutes / totalMeetings : 0;
  
  const busiestDay = Object.keys(dayCount).length > 0
    ? Object.keys(dayCount).reduce((a, b) => dayCount[a] > dayCount[b] ? a : b)
    : "N/A";
  
  return {
    totalMeetings,
    totalHours: totalHours.toFixed(2),
    averageDuration: avgDuration.toFixed(0) + " minutes",
    busiestDay,
    meetingDistribution: dayCount,
    timeframe
  };
}

function formatMeetingBrief(meetingData, attendeeInfo = [], emailContext = []) {
  const start = new Date(meetingData.startTime);
  const end = new Date(meetingData.endTime);
  const duration = Math.round((end - start) / 60000);
  
  return {
    title: meetingData.title,
    scheduledTime: start.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }),
    duration: `${duration} minutes`,
    location: meetingData.location || "Not specified",
    description: meetingData.description || "No description provided",
    attendees: attendeeInfo.length > 0 ? attendeeInfo : meetingData.attendees,
    relatedEmails: emailContext.length > 0 ? emailContext.map(e => ({
      subject: e.subject,
      from: e.from,
      date: e.date,
      preview: e.snippet
    })) : [],
    preparationTips: [
      "Review attendee backgrounds and roles",
      "Prepare questions based on email context",
      "Set up demo environment if needed",
      "Review meeting objectives and agenda"
    ]
  };
}

// Execute local tools
function executeLocalTool(toolName, toolInput) {
  switch(toolName) {
    case "calculateMeetingStats":
      return calculateMeetingStats(toolInput.meetings, toolInput.timeframe);
    case "formatMeetingBrief":
      return formatMeetingBrief(
        toolInput.meetingData,
        toolInput.attendeeInfo,
        toolInput.emailContext
      );
    default:
      throw new Error(`Unknown local tool: ${toolName}`);
  }
}
```

---

### **File: `api.js`** (Claude API Wrapper)
```javascript
const MCP_SERVER_URL = "http://localhost:3000";

async function callClaude(messages, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: messages,
      tools: LOCAL_TOOLS,  // Local tools defined in extension
      // Note: MCP server tools would be accessed via separate MCP protocol calls
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Claude API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  return await response.json();
}

// Call MCP server tool
async function callMCPTool(toolName, toolInput) {
  const response = await fetch(`${MCP_SERVER_URL}/mcp/call_tool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: toolName,
      arguments: toolInput
    })
  });
  
  if (!response.ok) {
    throw new Error(`MCP tool call failed: ${toolName}`);
  }
  
  const result = await response.json();
  return JSON.parse(result.content[0].text);
}

// Check if MCP server is running
async function checkMCPServer() {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/mcp/list_tools`);
    return response.ok;
  } catch (e) {
    return false;
  }
}
```

---

**Should I continue with the rest of the files (agent.js, popup.js, styles.css)?** 🚀

This is looking great so far - we have:
- ✅ MCP Server with 3 external tools
- ✅ Local extension with 2 calculation tools
- ✅ Clean separation of concerns
- ✅ Ready for multi-step agentic behavior
