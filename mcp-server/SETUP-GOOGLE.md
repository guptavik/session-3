# Connecting Google Calendar

The MCP server's `getUpcomingMeetings` tool needs a Google OAuth token to read your real calendar. One-time setup:

## 1. Create a Google Cloud OAuth client

1. Go to https://console.cloud.google.com
2. Create a new project (or pick an existing one)
3. **APIs & Services → Library** → search **Google Calendar API** → **Enable**
4. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: anything (e.g. "Meeting Intelligence Agent")
   - User support email: your email
   - Developer contact: your email
   - Scopes: skip (we request them in the auth URL)
   - Test users: add your own Google account
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth/callback`
   - Save → copy the **Client ID** and **Client secret**

## 2. Configure the MCP server

Create `mcp-server/.env` (it's git-ignored):

```
GOOGLE_CLIENT_ID=<your client id>
GOOGLE_CLIENT_SECRET=<your client secret>
```

## 3. Install dependencies and start the server

```
cd mcp-server
npm install
npm start
```

You should see:

```
MCP server running on http://localhost:3000
OAuth configured: true
Google authenticated: false
To connect Google Calendar: open http://localhost:3000/oauth/start in a browser.
```

## 4. Authorize the app

Open http://localhost:3000/oauth/start in any browser. Sign in with the Google account you added as a test user, accept the consent screen, and you'll land on a "Connected" page. The server writes the token to `mcp-server/tokens.json` (also git-ignored) and refreshes it automatically.

## 5. Run the extension

Reopen the Chrome extension popup. The "Google Calendar" status line should turn green. Click **Prepare for next meeting** and you'll get real events from your primary calendar.

---

## Troubleshooting

- **"OAuth not configured"** → `.env` is missing or wasn't picked up. Check the file is in `mcp-server/`, not the project root, and restart `npm start`.
- **Google says "redirect_uri_mismatch"** → the redirect URI in your Cloud Console must be **exactly** `http://localhost:3000/oauth/callback` (no trailing slash, http not https).
- **"Access blocked: the developer hasn't given you access"** → you skipped step 1.4 (test users). Add your Google account under OAuth consent screen → Test users.
- **Server shows `Token refresh failed`** → `tokens.json` may have a stale refresh_token. Delete it and re-run `/oauth/start`.

## Scopes used

Currently requests `https://www.googleapis.com/auth/calendar.readonly` only — read-only access to your calendar. To revoke, go to https://myaccount.google.com/permissions and remove the app.

Gmail (`gmail.readonly`) is **not** requested yet — `searchGmail` still returns mock data.
