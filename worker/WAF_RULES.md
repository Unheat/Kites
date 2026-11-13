# Cloudflare Edge WAF Configuration Instructions

To protect your free Worker quota (100,000 requests/day) from denial-of-wallet, bots, and brute force attacks, configure Cloudflare Edge WAF rules in your Cloudflare dashboard.

Edge WAF rules run at Cloudflare's network perimeter **before** the Worker runtime is invoked. Blocked requests consume **0 Worker invocations** and **0 Durable Object requests**.

---

## 1. Rate Limiting Rule (Cloudflare Free Tier)

Cloudflare Free includes **1 Rate Limiting Rule**.

### Configuration Steps:
1. Open the `12094852.xyz` zone in the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Security** $\to$ **WAF** $\to$ **Rate limiting rules**.
3. Click **Create rule**:
   * **Rule name**: `Limit Translation Endpoint Bursts`
   * **When incoming requests match**:
     * Hostname equals `api.12094852.xyz`
     * URI Path is `/v1/chat/completions` or `/v1/quota`
     * Method is `POST` or `GET`, respectively (exclude `OPTIONS` preflights)
     * Include quota polling when choosing the threshold; do not block normal popup refreshes.
   * **With the same characteristics**:
     * Count by: `IP`
   * **Requests**:
     * Greater than: `15` requests
     * Period: `10 seconds`
     * This is the Cloudflare Free-plan equivalent of the Worker's `5 requests / 3 seconds` limit because Free WAF requires a 10-second measurement window.
   * **Action**:
     * Choose: `Block`
     * Duration: `10 seconds` (or custom response: `HTTP 429 Too Many Requests`)
4. Click **Deploy**.

After the custom-domain endpoint passes an authenticated legacy-client translation test, verify and disable alternate production and preview `workers.dev` exposure under **Workers & Pages** $\to$ **kites-translate-pool** $\to$ **Domains**. Leaving an alternate production URL enabled permits bypass of this zone-level rule. Record the live dashboard state; source configuration alone does not establish whether that URL is enabled. Do not disable staging access accidentally: staging is a separate Worker, with separate bindings and controlled access.

The threshold above is an operational starting point, not a mathematically equivalent sliding-window guarantee. Verify current Cloudflare plan features before applying dashboard settings. Worker in-memory limits are isolate-local best-effort protection, not a global per-IP counter. Authentication and Durable Object admission limits remain necessary.

---

## 2. Custom WAF Security Rules (5 Rules on Free Tier)

Cloudflare Free allows **5 Custom Rules**.

### Rule A: Block Missing or Malformed Content-Type
* **Rule name**: `Enforce JSON Content-Type`
* **Expression**:
  ```text
  (http.request.uri.path eq "/v1/chat/completions" and http.request.method eq "POST" and not any(http.request.headers["content-type"][*] contains "application/json"))
  ```
* **Action**: `Block` (HTTP 400)

### Rule B: Drop Non-POST/OPTIONS Methods
* **Rule name**: `Strict HTTP Methods on Translation`
* **Expression**:
  ```text
  (http.request.uri.path eq "/v1/chat/completions" and not http.request.method in {"POST" "OPTIONS"})
  ```
* **Action**: `Block` (HTTP 405)

---

## 3. Worker Secrets Deployment Commands

Once your Worker is created in Cloudflare, set your secrets from the terminal:

```bash
cd worker

# Google Auth Client ID (Audience): Web Application client used by launchWebAuthFlow
npx wrangler secret put GOOGLE_CLIENT_ID

# Chrome Extension client from manifest.json's oauth2.client_id (silent getAuthToken refresh).
# Must be set, or every token minted after the first hourly refresh is rejected as 401.
npx wrangler secret put GOOGLE_EXTENSION_CLIENT_ID

# HMAC Salt for anonymous user quota tracking
npx wrangler secret put JWT_SALT

# Active AI Provider Keys (as needed)
npx wrangler secret put NVIDIA_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put MISTRAL_API_KEY

# Enables the live credential health probe (route answers 404 while unset)
npx wrangler secret put PROVIDER_HEALTH_TOKEN
```

### Why keys cannot be read back

Cloudflare Worker Secrets are write-only. Neither the dashboard, the CLI, nor the REST API
returns a stored value, and production secrets are never exposed to local `wrangler dev`. If a
key needs to be verified or moved, the only options are:

1. Let the Worker use it — `GET /internal/provider-health` probes every catalog route through
the real adapters and reports verdicts only (`ok`, `rate_limited`, `invalid_key`,
`request_rejected`, `missing_secret`, `upstream_error`). It never returns key material.
2. Rotate it — create a new key at the provider, `npx wrangler secret put <NAME>`, then re-run
the probe.

The probe is wired into CI as `.github/workflows/worker-key-health.yml` (weekly plus manual
dispatch), gated on the repository secret `PROVIDER_HEALTH_TOKEN`. The GitHub secret and the
Worker secret must hold the same value; rotate both together (README: `docs/development/ci-cd.md`
section 4.1). A missing GitHub secret fails the workflow immediately — that is CI wiring, not a
dead provider key.

---

## 4. Local Development

Run the worker locally against local SQLite Durable Objects:

```bash
cd worker
npm install
npx wrangler dev
```
