import http from "node:http";

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!;
const REDIRECT_URI = "http://localhost:3333/callback";

// Scopes required for LinkedIn Ads API
// - rw_ads: Read-write access to ads (manage advertising accounts)
// - r_ads_reporting: Read ads analytics/reporting
// - r_organization_social: Read organization posts (to get creative content/images)
// - w_organization_social: Write organization content (upload images owned by org for ads)
const SCOPES = "rw_ads r_ads_reporting r_organization_social w_organization_social";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Error: Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables");
  process.exit(1);
}

const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", Math.random().toString(36).substring(2));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:3333`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      const errorDescription = url.searchParams.get("error_description");
      console.error(`\nOAuth error: ${error} - ${errorDescription}`);
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><p>${error}: ${errorDescription}</p>`);
      setTimeout(() => process.exit(1), 1000);
      return;
    }

    if (!code) {
      res.writeHead(400);
      res.end("No authorization code received");
      return;
    }

    try {
      const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokenData = await tokenResponse.json() as Record<string, unknown>;

      if (tokenData.access_token) {
        console.log("\n=== SUCCESS ===");
        console.log(`Access Token: ${tokenData.access_token}`);
        if (tokenData.refresh_token) {
          console.log(`Refresh Token: ${tokenData.refresh_token}`);
        }
        console.log(`Expires In: ${tokenData.expires_in} seconds`);
        console.log("===============\n");
        console.log("Set the refresh token as a Cloudflare secret:");
        console.log("  wrangler secret put LINKEDIN_REFRESH_TOKEN");
        console.log("");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Success!</h1><p>Token has been printed to your terminal. You can close this tab.</p>");
      } else {
        console.error("No access token in response:", tokenData);
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      }
    } catch (err) {
      console.error("Token exchange failed:", err);
      res.writeHead(500);
      res.end("Token exchange failed");
    }

    setTimeout(() => process.exit(0), 1000);
  }
});

server.listen(3333, () => {
  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback on http://localhost:3333/callback...\n");
});
