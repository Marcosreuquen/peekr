# Rules Engine

The rules engine lets you intercept requests passing through peekr and either **block** them or return **mock** responses -- without touching the upstream server.

Rules are evaluated in memory and take effect immediately. No restart required.

## What Rules Do

| Action | Behavior |
|--------|----------|
| **Block** | Returns `403 Forbidden` to the client. The request never reaches the upstream server. |
| **Mock** | Returns a custom response (status, headers, body) to the client. The upstream server is not contacted. |

## Rule Fields

Each rule has the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| `host` | Yes | Exact hostname to match (e.g. `api.example.com`) |
| `method` | Yes | HTTP method to match, or `*` for all methods |
| `path` | Yes | Path prefix to match (e.g. `/api/v1` matches `/api/v1/users`) |
| `action` | Yes | `"block"` or `"mock"` |
| `mockConfig` | Only for mock | Object with `status`, `headers`, and `body` for the mock response |

### Mock Config

For mock rules, `mockConfig` defines what the client receives:

```json
{
  "status": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"message\": \"mocked\"}"
}
```

## Matching Logic

When a request arrives, peekr evaluates rules in order. The **first match wins**:

1. **Host** -- Exact match against the request's hostname.
2. **Method** -- Exact match, or `*` matches any method.
3. **Path** -- Prefix match. Rule path `/api` matches request paths `/api`, `/api/users`, `/api/v1/data`, etc.

If no rule matches, the request is forwarded to the upstream server normally.

## Creating Rules

### From the Context Menu

The fastest way to create a rule:

1. Right-click a request row in the dashboard.
2. Select **Block this host** or **Mock this host**.
3. The rule is created immediately. For mock rules, the rules drawer opens so you can configure the response.

### From the Rules Drawer

For full control over rule parameters:

1. Click the gear icon in the top bar to open the rules drawer.
2. Fill in the form fields: host, method, path, action, and mock config (if applicable).
3. Submit to create the rule.

### From the API

Use the REST API for programmatic rule management. See [API Endpoints](#api-endpoints) below.

## Managing Rules

Open the rules drawer (gear icon) to see all active rules. Each rule displays its host, method, path, and action. Click the delete button next to a rule to remove it.

When rules change (created or deleted), the dashboard receives a `rules-change` SSE event and refreshes the list automatically.

## API Endpoints

### List All Rules

```bash
curl http://localhost:3000/api/rules
```

Returns a JSON array of all active rules.

### Create a Rule

**Block rule:**

```bash
curl -X POST http://localhost:3000/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ads.tracker.com",
    "method": "*",
    "path": "/",
    "action": "block"
  }'
```

**Mock rule:**

```bash
curl -X POST http://localhost:3000/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "api.example.com",
    "method": "GET",
    "path": "/api/v1/users",
    "action": "mock",
    "mockConfig": {
      "status": 200,
      "headers": { "Content-Type": "application/json" },
      "body": "[{\"id\": 1, \"name\": \"Test User\"}]"
    }
  }'
```

### Delete a Rule

```bash
curl -X DELETE http://localhost:3000/api/rules/RULE_ID
```

Replace `RULE_ID` with the rule's `id` from the list response.

## Example Workflows

### Block a Noisy Endpoint

During development, a third-party analytics endpoint floods your traffic view:

1. Spot a request to `analytics.vendor.com` in the dashboard.
2. Right-click the row and select **Block this host**.
3. All future requests to `analytics.vendor.com` return `403` and show a red **BLK** badge.

Your traffic view is now clean, and the upstream analytics service receives no data.

### Mock an Unavailable Service

A backend service you depend on is down, but you need to keep developing:

1. Open the rules drawer (gear icon).
2. Create a mock rule:
   - **Host:** `api.backend.com`
   - **Method:** `GET`
   - **Path:** `/api/v1/config`
   - **Action:** mock
   - **Status:** `200`
   - **Headers:** `{ "Content-Type": "application/json" }`
   - **Body:** `{"feature_flags": {"new_ui": true}}`
3. Your application now receives the mocked config response, and matched requests show an orange **MCK** badge.

When the real service comes back, delete the rule and traffic flows normally again.
