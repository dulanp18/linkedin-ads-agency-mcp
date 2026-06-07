# Deployment Guide

End-to-end instructions for deploying your own instance of this LinkedIn Ads MCP server. You'll end up with a private URL you can plug into Claude Co-work, Claude Desktop, or any MCP-compatible client to manage your LinkedIn Ads.

Estimated time: **45–60 minutes of active work**, plus **1–10 days waiting** for LinkedIn to approve Marketing Developer Platform access.

---

## What you'll have at the end

A Cloudflare Worker hosted at `https://<your-worker-name>.<your-subdomain>.workers.dev` with 24 LinkedIn Ads tools, gated by a path-based auth token only you know.

Your final connection URL will look like:
```
https://<your-worker>.workers.dev/mcp/<your-32-byte-hex-token>
```

---

## Prerequisites

1. **Node.js 18 or later** — `node --version` should print `v18.x` or higher
2. **A LinkedIn account** with access to a LinkedIn Page (you need to be a page admin to grant the OAuth scopes)
3. **A Cloudflare account** — free tier is fine for getting started ([sign up](https://dash.cloudflare.com/sign-up))
4. **A LinkedIn Ad Account** that the LinkedIn account above can access
5. **Basic terminal familiarity** — running commands, editing files

---

## Step 1 — Get the code

```bash
git clone https://github.com/<owner>/linkedin-ads-agency-mcp.git
cd linkedin-ads-agency-mcp
npm install
```

If you were given a zip instead, unzip it and run `npm install` inside the directory.

---

## Step 2 — Create a LinkedIn Developer App

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) and click **Create app**
2. Fill in:
   - **App name**: anything (e.g. `Ads MCP - <your business>`)
   - **LinkedIn Page**: select the company page that owns the ad account
   - **App logo**: any image works
3. On the **Auth** tab:
   - Note your **Client ID** and **Client Secret** — you'll need these in Step 4
   - Under **Authorized redirect URLs for your app**, add: `http://localhost:3333/callback`
4. On the **Products** tab:
   - Request access to **Marketing Developer Platform** — this is a manual LinkedIn review and can take **1–10 days**. You'll get an email when approved.
   - You can do the rest of Steps 3–4 in the meantime, but the OAuth flow in Step 4 will fail until LinkedIn approves you.

The OAuth scopes the script requests are: `rw_ads`, `r_ads_reporting`, `r_organization_social`, `w_organization_social`. You don't need to configure these manually — they're requested at login time and granted automatically once Marketing Developer Platform is approved.

---

## Step 3 — Generate your MCP auth token

This is the random secret that gates your deployed worker. Anyone who knows the URL with this token can call your MCP; keep it secret.

```bash
openssl rand -hex 32
```

Copy the 64-character output. You'll paste it into `.dev.vars` in Step 5.

---

## Step 4 — Generate your LinkedIn refresh token

**Only do this once Marketing Developer Platform is approved.**

```bash
LINKEDIN_CLIENT_ID=<your-client-id> \
LINKEDIN_CLIENT_SECRET=<your-client-secret> \
npx tsx scripts/get-refresh-token.ts
```

The script will:
1. Print an authorization URL
2. Start a local server on port 3333
3. Wait for you to open the URL in a browser, log in to LinkedIn, and consent to the scopes
4. Receive the callback, exchange the code for tokens, and print the **Refresh Token** to your terminal

Copy the refresh token (a long string starting with `AQU...`). Refresh tokens are valid for 365 days; you'll regenerate before expiry.

> **Common error: "redirect_uri does not match"** — go back to Step 2 and confirm you added `http://localhost:3333/callback` to the app's Authorized redirect URLs.

---

## Step 5 — Configure `.dev.vars`

Create a local secrets file (this file is gitignored — never commit it):

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in all four values:

```
LINKEDIN_CLIENT_ID=<from Step 2>
LINKEDIN_CLIENT_SECRET=<from Step 2>
LINKEDIN_REFRESH_TOKEN=<from Step 4>
MCP_AUTH_TOKEN=<from Step 3>
```

### Optional — lock the server to a single ad account

Add `ALLOWED_ACCOUNT_ID` to restrict the entire server to one LinkedIn ad
account. When set, every tool rejects any other account id and `list_accounts`
only ever returns the allowed account. Leave it unset for unrestricted access
to all accounts the OAuth token can reach.

```
ALLOWED_ACCOUNT_ID=<numeric ad account id, e.g. 123456789>
```

For production, set it as a Cloudflare secret alongside the others in Step 7b:

```bash
npx wrangler secret put ALLOWED_ACCOUNT_ID
```

---

## Step 6 — Test locally

```bash
npm run dev
```

In another terminal, smoke-test the auth gate and the OAuth flow:

```bash
TOKEN="<your MCP_AUTH_TOKEN>"

# Should return 404 (no token in URL)
curl -i http://localhost:8787/mcp

# Should return 200 and start an MCP session
curl -X POST "http://localhost:8787/mcp/$TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

If both behave as expected, your LinkedIn credentials and auth gate are working. `Ctrl+C` to stop the dev server.

---

## Step 7 — Deploy to Cloudflare

### 7a. Authenticate Wrangler

```bash
npx wrangler login
```

This opens a browser window. Approve, then close the tab.

### 7b. Upload your secrets

The safest way is to upload all four secrets at once from a JSON file (no values pass through shell history):

```bash
node -e "
const fs = require('fs');
const vars = fs.readFileSync('.dev.vars','utf8').trim().split('\n').reduce((a,l)=>{const i=l.indexOf('=');a[l.slice(0,i)]=l.slice(i+1);return a;},{});
fs.writeFileSync('/tmp/secrets.json', JSON.stringify(vars));
"
npx wrangler secret bulk /tmp/secrets.json
rm /tmp/secrets.json
```

Wrangler will offer to create the Worker if it doesn't exist yet — say yes.

### 7c. Deploy the code

```bash
npm run deploy
```

You'll see something like:
```
Deployed linkedin-ads-agency-mcp triggers
  https://linkedin-ads-agency-mcp.<your-subdomain>.workers.dev
```

That URL is your worker's host. Your full MCP connection URL is:

```
https://linkedin-ads-agency-mcp.<your-subdomain>.workers.dev/mcp/<your MCP_AUTH_TOKEN>
```

---

## Step 8 — Connect from an MCP client

### Claude Co-work / Claude Desktop

Add a custom MCP server with the URL from Step 7c. The token is part of the URL itself; no additional auth headers needed.

### First call to make

Use the `list_accounts` tool — it returns every LinkedIn Ad Account your OAuth token can reach. Copy the IDs from there; you'll pass them as `accountId` to every other tool.

---

## Maintenance

- **Refresh token expires every 365 days.** Re-run Step 4 before then and `npx wrangler secret put LINKEDIN_REFRESH_TOKEN` with the new value.
- **Rotate the MCP auth token** any time you suspect the URL has leaked: `openssl rand -hex 32 | npx wrangler secret put MCP_AUTH_TOKEN`, then redistribute the new URL.
- **Logs and errors**: `npx wrangler tail` streams live worker logs.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `403 Forbidden` from LinkedIn API | Marketing Developer Platform access not yet approved (Step 2) |
| OAuth callback says "redirect_uri does not match" | Forgot to add `http://localhost:3333/callback` to the LinkedIn app's auth settings |
| `404 Not Found` from your worker | Wrong/missing `MCP_AUTH_TOKEN` in the URL |
| `EADDRINUSE` on port 3333 | A previous `get-refresh-token.ts` is still running — `lsof -ti:3333 \| xargs kill -9` |
| `EADDRINUSE` on port 8787 | A previous `wrangler dev` is still running — `lsof -ti:8787 \| xargs kill -9` |
| `Server misconfigured` (500) | `MCP_AUTH_TOKEN` not set as a Cloudflare secret — re-run Step 7b |
| Tools return empty arrays | OAuth token may not have access to that ad account — call `list_accounts` to see what it can see |

---

## What this server can do

24 tools across these categories:

- **Accounts** — `list_accounts`, `get_account_details`
- **Campaigns** — `list_campaigns`, `get_campaign_groups`, `create_campaign_group`, `update_campaign_group`, `delete_campaign_group`, `create_campaign`, `update_campaign`, `delete_campaign`
- **Creatives** — `create_creative`, `create_inline_ad`, `update_creative_status`
- **Performance** — `get_campaign_performance`, `get_creative_performance`, `get_daily_trends`, `compare_performance`
- **Audience** — `get_audience_demographics`, `get_audience_reach`, `list_saved_audiences`
- **Conversions & Leads** — `get_conversion_performance`, `list_conversions`, `get_lead_gen_performance`, `list_lead_forms`

The OAuth token determines which ad accounts you can manage — typically every account your LinkedIn user is a member of.
