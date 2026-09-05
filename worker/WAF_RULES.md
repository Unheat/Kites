# Cloudflare Edge WAF Configuration Instructions

To protect your free Worker quota (100,000 requests/day) from denial-of-wallet, bots, and brute force attacks, configure Cloudflare Edge WAF rules in your Cloudflare dashboard.

Edge WAF rules run at Cloudflare's network perimeter **before** the Worker runtime is invoked. Blocked requests consume **0 Worker invocations** and **0 Durable Object requests**.

---

## 1. Rate Limiting Rule (Cloudflare Free Tier)

Cloudflare Free includes **1 Rate Limiting Rule**.

### Configuration Steps:
1. Open your domain or `workers.dev` zone in the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Security** $\to$ **WAF** $\to$ **Rate limiting rules**.
3. Click **Create rule**:
   * **Rule name**: `Limit Translation Endpoint Bursts`
   * **When incoming requests match**:
     * Field: `URI Path`
     * Operator: `equals`
     * Value: `/v1/chat/completions`
   * **With the same characteristics**:
     * Count by: `IP`
   * **Requests**:
     * Greater than: `20` requests
     * Period: `10 seconds`
   * **Action**:
     * Choose: `Block`
     * Duration: `10 seconds` (or custom response: `HTTP 429 Too Many Requests`)
4. Click **Deploy**.

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

# Google Auth Client ID (Audience)
npx wrangler secret put GOOGLE_CLIENT_ID

# HMAC Salt for anonymous user quota tracking
npx wrangler secret put JWT_SALT

# Active AI Provider Keys (as needed)
npx wrangler secret put NVIDIA_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
```

---

## 4. Local Development

Run the worker locally against local SQLite Durable Objects:

```bash
cd worker
npm install
npx wrangler dev
```
