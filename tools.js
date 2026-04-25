// Local tools — pure functions that run inside the extension popup.
// Calendar / email / web lookups live on the MCP server (see mcp-server/server.js).

const LOCAL_TOOLS = [
  {
    name: "calculateMeetingStats",
    description:
      "Computes statistics over a list of meeting objects (total count, total hours, average duration, " +
      "busiest day, distribution by weekday). Use when the user asks about meeting load or schedule analysis. " +
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
          description: "Optional human-readable label included in the report."
        }
      },
      required: ["meetings"]
    }
  },
  {
    name: "formatMeetingBrief",
    description:
      "Formats collected meeting data into a structured brief object (title, time, duration, attendees, " +
      "related emails, generic prep checklist). Call this AFTER you have gathered attendee info and email " +
      "context, but BEFORE writing your final user-facing response. The output is a deterministic data " +
      "structure — narrate it (and add any meeting-specific analysis) in your final message.",
    input_schema: {
      type: "object",
      properties: {
        meetingData: {
          type: "object",
          description: "The meeting object as returned by getUpcomingMeetings."
        },
        attendeeInfo: {
          type: "array",
          description: "Optional array of attendee profile objects (from searchWebInfo with searchType='person').",
          items: { type: "object" }
        },
        emailContext: {
          type: "array",
          description: "Optional array of related email objects (from searchGmail).",
          items: { type: "object" }
        }
      },
      required: ["meetingData"]
    }
  }
];

// ---------- Implementations ----------

function calculateMeetingStats({ meetings, timeframe = "week" }) {
  if (!Array.isArray(meetings)) {
    throw new Error("calculateMeetingStats requires 'meetings' to be an array.");
  }
  const totalMeetings = meetings.length;

  let totalMinutes = 0;
  const dayCount = {};

  for (const m of meetings) {
    const start = new Date(m.startTime);
    const end = new Date(m.endTime);
    const duration = (end - start) / 60000;
    if (Number.isFinite(duration) && duration > 0) totalMinutes += duration;

    const day = start.toLocaleDateString("en-US", { weekday: "long" });
    dayCount[day] = (dayCount[day] || 0) + 1;
  }

  const totalHours = totalMinutes / 60;
  const avgDuration = totalMeetings > 0 ? totalMinutes / totalMeetings : 0;
  const busiestDay = Object.keys(dayCount).length > 0
    ? Object.keys(dayCount).reduce((a, b) => dayCount[a] > dayCount[b] ? a : b)
    : "N/A";

  return {
    totalMeetings,
    totalHours: totalHours.toFixed(2),
    averageDuration: `${avgDuration.toFixed(0)} minutes`,
    busiestDay,
    meetingDistribution: dayCount,
    timeframe
  };
}

function formatMeetingBrief({ meetingData, attendeeInfo = [], emailContext = [] }) {
  if (!meetingData || !meetingData.title) {
    throw new Error("formatMeetingBrief requires 'meetingData' with a 'title'.");
  }
  const start = new Date(meetingData.startTime);
  const end = new Date(meetingData.endTime);
  const durationMin = Number.isFinite(end - start) ? Math.round((end - start) / 60000) : null;

  return {
    title: meetingData.title,
    scheduledTime: start.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }),
    duration: durationMin != null ? `${durationMin} minutes` : "unknown",
    location: meetingData.location || "Not specified",
    description: meetingData.description || "No description provided",
    attendees: attendeeInfo.length > 0 ? attendeeInfo : (meetingData.attendees || []),
    relatedEmails: emailContext.map(e => ({
      subject: e.subject,
      from: e.from,
      date: e.date,
      preview: e.snippet || e.preview
    })),
    preparationChecklist: [
      "Review attendee backgrounds and roles",
      "Skim related email threads for prior commitments",
      "Prepare 2-3 questions tailored to the meeting agenda",
      "Confirm logistics (location, dial-in, demo environment)"
    ]
  };
}

// ---------- Dispatcher ----------

async function executeLocalTool(toolName, toolInput) {
  switch (toolName) {
    case "calculateMeetingStats": return calculateMeetingStats(toolInput || {});
    case "formatMeetingBrief":    return formatMeetingBrief(toolInput || {});
    default:
      throw new Error(`Unknown local tool: ${toolName}`);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOCAL_TOOLS, executeLocalTool };
}
