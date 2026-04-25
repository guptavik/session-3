// UI controller for the Meeting Intelligence Agent popup.
// Wires the API key form, query input, and reasoning/brief panels
// to the agent loop in agent.js.

(function () {
  // ---------- DOM refs ----------
  const apiKeyInput = document.getElementById("api-key");
  const saveKeyBtn  = document.getElementById("save-key-btn");
  const keyStatus   = document.getElementById("key-status");
  const mcpStatus   = document.getElementById("mcp-status");

  const customQuery = document.getElementById("custom-query");
  const runBtn      = document.getElementById("run-btn");
  const quickBtns   = document.querySelectorAll(".quick-btn");

  const reasoningSection = document.getElementById("reasoning-section");
  const stepsContainer   = document.getElementById("steps");

  const briefSection = document.getElementById("brief-section");
  const briefEl      = document.getElementById("brief");

  const errorSection = document.getElementById("error-section");
  const errorEl      = document.getElementById("error");

  // Track step DOM nodes by stepId so we can update them in place.
  const stepNodes = new Map();
  let running = false;

  // ---------- Init: load saved key + check MCP server ----------
  (async function init() {
    try {
      const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
      if (anthropicApiKey) {
        apiKeyInput.value = anthropicApiKey;
        showKeyStatus("Key loaded from storage.", "success");
      }
    } catch (err) {
      showKeyStatus(`Failed to load key: ${err.message}`, "error");
    }
    refreshMcpStatus();
  })();

  async function refreshMcpStatus() {
    showMcpStatus("Checking MCP server...", null);
    const ok = await checkMcpServer();
    if (ok) {
      showMcpStatus(`MCP server: connected (${MCP_SERVER_URL})`, "success");
    } else {
      showMcpStatus(`MCP server: not reachable at ${MCP_SERVER_URL}. Start it with 'npm start' in mcp-server/.`, "error");
    }
  }

  // ---------- Event wiring ----------
  saveKeyBtn.addEventListener("click", onSaveKey);
  runBtn.addEventListener("click", () => onRun(customQuery.value.trim()));
  customQuery.addEventListener("keydown", e => {
    if (e.key === "Enter") onRun(customQuery.value.trim());
  });
  for (const btn of quickBtns) {
    btn.addEventListener("click", () => onRun(btn.dataset.query));
  }

  // ---------- Handlers ----------
  async function onSaveKey() {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showKeyStatus("Enter a key first.", "error");
      return;
    }
    try {
      await setApiKey(key);
      showKeyStatus("Key saved.", "success");
    } catch (err) {
      showKeyStatus(`Save failed: ${err.message}`, "error");
    }
  }

  async function onRun(query) {
    if (running) return;
    if (!query) {
      showError("Enter a query (or click a quick action).");
      return;
    }
    if (!apiKeyInput.value.trim()) {
      showError("Save your Anthropic API key first.");
      return;
    }

    resetOutput();
    setRunning(true);
    reasoningSection.classList.remove("hidden");

    try {
      await runAgent(query, {
        onStep: handleStep,
        onAssistantText: handleAssistantText,
        onFinalText: handleFinalText,
        onError: handleError
      });
    } catch (err) {
      // runAgent re-throws after calling onError, so this is mostly a safety net.
      handleError(err);
    } finally {
      setRunning(false);
    }
  }

  // ---------- Reasoning chain rendering ----------
  function handleStep(step) {
    let node = stepNodes.get(step.stepId);
    if (!node) {
      node = createStepNode(step);
      stepNodes.set(step.stepId, node);
      stepsContainer.appendChild(node);
    }
    updateStepNode(node, step);
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function createStepNode(step) {
    const wrapper = document.createElement("div");
    wrapper.className = "step";

    const header = document.createElement("div");
    header.className = "step-header";
    header.innerHTML = `
      <span class="step-icon"></span>
      <span class="step-num">Step ${step.stepId}</span>
      <span class="step-origin"></span>
      <span class="step-tool"></span>
      <span class="step-summary"></span>
      <span class="step-chevron">▾</span>
    `;
    header.addEventListener("click", () => wrapper.classList.toggle("collapsed"));

    const body = document.createElement("div");
    body.className = "step-body";

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function updateStepNode(node, step) {
    // Status class drives icon color.
    node.className = `step step-status-${step.status}`;
    if (step.status === "success") node.classList.add("collapsed");

    const iconEl    = node.querySelector(".step-icon");
    const toolEl    = node.querySelector(".step-tool");
    const originEl  = node.querySelector(".step-origin");
    const summaryEl = node.querySelector(".step-summary");
    const body      = node.querySelector(".step-body");

    iconEl.textContent = iconFor(step.status);
    toolEl.textContent = `${step.toolName}()`;
    if (step.origin) {
      originEl.textContent = step.origin === "mcp" ? "MCP" : "LOCAL";
      originEl.className = `step-origin step-origin-${step.origin}`;
    }
    summaryEl.textContent = summaryFor(step);

    body.innerHTML = "";

    body.appendChild(makeSection("Input", JSON.stringify(step.toolInput || {}, null, 2)));

    if (step.status === "success") {
      const resultStr = JSON.stringify(step.result, null, 2);
      body.appendChild(makeSection("Result", resultStr));
      if (step.retried) {
        body.appendChild(makeNote("Recovered after one retry."));
      }
    } else if (step.status === "retrying") {
      body.appendChild(makeNote(`First attempt failed: ${step.error}. Retrying...`));
    } else if (step.status === "error") {
      const detail = step.firstError && step.firstError !== step.error
        ? `${step.error}\n\nFirst attempt: ${step.firstError}`
        : step.error;
      body.appendChild(makeSection("Error", detail, true));
    }
    // For "loading", body just shows Input.
  }

  function iconFor(status) {
    switch (status) {
      case "loading":  return "⏳";
      case "retrying": return "🔄";
      case "success":  return "✓";
      case "error":    return "❌";
      default:         return "•";
    }
  }

  function summaryFor(step) {
    switch (step.status) {
      case "loading":  return "running";
      case "retrying": return "retrying";
      case "success":  return summarizeResult(step.result);
      case "error":    return "failed";
      default:         return "";
    }
  }

  function summarizeResult(result) {
    if (Array.isArray(result)) return `${result.length} item${result.length === 1 ? "" : "s"}`;
    if (result && typeof result === "object") {
      if (typeof result.totalMeetings === "number") return `${result.totalMeetings} meetings`;
      if (result.name) return result.name;
      if (result.title) return result.title;
    }
    return "ok";
  }

  function makeSection(label, content, isError) {
    const wrapper = document.createElement("div");
    wrapper.className = isError ? "step-section step-error" : "step-section";

    const labelEl = document.createElement("div");
    labelEl.className = "step-section-label";
    labelEl.textContent = label;

    const pre = document.createElement("pre");
    pre.textContent = content;

    wrapper.appendChild(labelEl);
    wrapper.appendChild(pre);
    return wrapper;
  }

  function makeNote(text) {
    const note = document.createElement("div");
    note.className = "step-section-label";
    note.textContent = text;
    return note;
  }

  function handleAssistantText(text) {
    // Inline reasoning prose Claude emits between tool calls.
    const node = document.createElement("div");
    node.className = "assistant-text";
    node.textContent = text;
    stepsContainer.appendChild(node);
  }

  function handleFinalText(text) {
    if (!text) return;
    briefSection.classList.remove("hidden");
    briefEl.innerHTML = renderMarkdown(text);
  }

  function handleError(err) {
    const message = err && err.message ? err.message : String(err);
    showError(message);
  }

  function showError(message) {
    errorSection.classList.remove("hidden");
    errorEl.textContent = message;
  }

  function resetOutput() {
    stepNodes.clear();
    stepsContainer.innerHTML = "";
    briefEl.innerHTML = "";
    briefSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    errorEl.textContent = "";
    reasoningSection.classList.add("hidden");
  }

  function setRunning(isRunning) {
    running = isRunning;
    runBtn.disabled = isRunning;
    runBtn.textContent = isRunning ? "Running..." : "Go";
    customQuery.disabled = isRunning;
    for (const btn of quickBtns) btn.disabled = isRunning;
  }

  function showKeyStatus(message, kind) {
    keyStatus.textContent = message;
    keyStatus.className = `hint ${kind || ""}`.trim();
  }

  function showMcpStatus(message, kind) {
    mcpStatus.textContent = message;
    mcpStatus.className = `hint ${kind || ""}`.trim();
  }

  // ---------- Minimal Markdown renderer ----------
  // Handles: # / ## / ### headings, **bold**, *italic*, `code`,
  // - bullet lists, - [ ] / - [x] checklists, [text](url) links.
  // All text content is HTML-escaped before any tag substitution.
  function renderMarkdown(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      // Headings
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
        const level = m[1].length;
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        i++;
        continue;
      }

      // List block (handles bullets and checklists together)
      if (/^\s*-\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*-\s+/, ""));
          i++;
        }
        out.push("<ul>");
        for (const item of items) {
          const checkMatch = item.match(/^\[( |x|X)\]\s+(.+)$/);
          if (checkMatch) {
            const checked = checkMatch[1].toLowerCase() === "x";
            const box = checked ? "☑" : "☐";
            out.push(`<li class="checklist">${box} ${inline(checkMatch[2])}</li>`);
          } else {
            out.push(`<li>${inline(item)}</li>`);
          }
        }
        out.push("</ul>");
        continue;
      }

      // Paragraph: gather consecutive non-empty, non-special lines.
      const buf = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^\s*-\s+/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }

    return out.join("\n");
  }

  function inline(text) {
    let s = escapeHtml(text);
    // Code spans first (so their contents aren't further processed).
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // Bold then italic. Order matters because **x** would also match *x*.
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    // Links [text](url) — URL is already HTML-escaped by escapeHtml above.
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    return s;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
