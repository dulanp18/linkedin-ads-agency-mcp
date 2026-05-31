# LinkedIn Ads Agency MCP

A Model Context Protocol (MCP) server for managing LinkedIn Ads accounts, deployed on Cloudflare Workers with Durable Objects for stateful sessions.

Exposes 24 tools covering account discovery, campaigns, creatives, analytics, demographics, conversions, lead gen, and audience management. Access is governed by your LinkedIn OAuth token — the server can only reach accounts the token is authorised for.

## Architecture

- **Cloudflare Worker** (`src/index.ts`) — HTTP entrypoint exposing `/mcp` (streamable HTTP) and `/sse` (SSE) transports
- **Durable Object** (`LinkedInAdsMCP`) — per-session MCP agent built on `agents/mcp` + `@modelcontextprotocol/sdk`
- **LinkedIn client** (`src/linkedin-ads-client.ts`) — handles OAuth refresh, Rest.li protocol headers, retry/rate-limit logic

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure OAuth credentials
Copy the example file and fill in your LinkedIn app credentials from the [LinkedIn Developer Portal](https://www.linkedin.com/developers/):
```bash
cp .dev.vars.example .dev.vars
```

Required scopes on the LinkedIn app:
- `rw_ads`
- `r_ads_reporting`
- `r_organization_social`
- `w_organization_social`

### 3. Generate a refresh token
With `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` exported in your shell:
```bash
npx tsx scripts/get-refresh-token.ts
```
This starts a local server on port 3333, opens an OAuth consent flow, and prints the refresh token. Paste it into `.dev.vars` as `LINKEDIN_REFRESH_TOKEN`.

> The redirect URI `http://localhost:3333/callback` must be registered on your LinkedIn app's auth settings.

## Authentication

The MCP endpoints are gated by a path-based bearer token. Generate one with `openssl rand -hex 32` and set it as `MCP_AUTH_TOKEN` in `.dev.vars` (and as a Cloudflare secret for production).

Client connection URLs include the token:
```
https://<worker-host>/mcp/<MCP_AUTH_TOKEN>
https://<worker-host>/sse/<MCP_AUTH_TOKEN>
```

Anything else returns `404 Not Found`. Token comparison is constant-time.

## Local development

```bash
npm run dev
```
Worker is available at `http://localhost:8787`. Connect an MCP client to `http://localhost:8787/mcp/<MCP_AUTH_TOKEN>` or `http://localhost:8787/sse/<MCP_AUTH_TOKEN>`.

## Type checking

```bash
npm run typecheck
```

## Deployment

Set production secrets:
```bash
npx wrangler secret put LINKEDIN_CLIENT_ID
npx wrangler secret put LINKEDIN_CLIENT_SECRET
npx wrangler secret put LINKEDIN_REFRESH_TOKEN
npx wrangler secret put MCP_AUTH_TOKEN
```

Deploy:
```bash
npm run deploy
```

## Available tools

Use `list_accounts` after connecting to discover which LinkedIn Ad Accounts your token can access; every other tool takes an `accountId` parameter.

Categories:
- **Accounts** — `list_accounts`, `get_account_details`
- **Campaigns** — `list_campaigns`, `get_campaign_groups`, `create_campaign_group`, `update_campaign_group`, `delete_campaign_group`, `create_campaign`, `update_campaign`, `delete_campaign`
- **Creatives** — `create_creative`, `create_inline_ad`, `update_creative_status`
- **Performance** — `get_campaign_performance`, `get_creative_performance`, `get_daily_trends`, `compare_performance`
- **Audience** — `get_audience_demographics`, `get_audience_reach`, `list_saved_audiences`
- **Conversions & Leads** — `get_conversion_performance`, `list_conversions`, `get_lead_gen_performance`, `list_lead_forms`
