# peekr

Zero-dependency HTTP capture proxy. Intercepts outgoing calls from any app, logs the full request/response cycle, and optionally forwards to the real upstream service.

No config files. No dependencies. Node.js stdlib only.

## Install

```bash
npm install -g peekr
```

Or run directly without installing:

```bash
npx peekr --target api.example.com
```

## Usage

```
peekr --target <host> [options]
peekr --no-forward [options]
```

### Options

| Flag              | Description                                       | Default |
| ----------------- | ------------------------------------------------- | ------- |
| `--target <host>` | Upstream HTTPS hostname to forward requests to    | —       |
| `--port <port>`   | Local port to listen on                           | 9999    |
| `--no-forward`    | Capture only — don't forward, return a mock 200   | false   |
| `--no-headers`    | Omit headers from log output                      | false   |
| `--mock <json>`   | Custom JSON body to return in `--no-forward` mode | `{}`    |
| `-h, --help`      | Show help                                         |         |

## Examples

### Capture and forward to a real API

```bash
peekr --target api.example.com
```

### Capture without forwarding (safe / offline testing)

```bash
peekr --no-forward
```

### Custom mock response

```bash
peekr --no-forward --mock '{"status":"ok","id":42}'
```

### Custom port, hide headers

```bash
peekr --target api.example.com --port 8080 --no-headers
```

## How it works

```
Your app  →  peekr (localhost:9999)  →  Real upstream (HTTPS)
                    ↓
          Logs method, path,
          headers, payload,
          and response
```

1. Start `peekr` and point your app's base URL env var to `http://localhost:9999`
2. Your app sends requests normally — it just thinks the service is local
3. `peekr` logs everything and forwards to the real upstream
4. Restore the original URL when done

## Step-by-step example (NestJS + any HTTP client)

**1. Start peekr:**

```bash
peekr --target unification.useinsider.com
```

**2. Change the base URL in your app's `.env`:**

```env
SOME_SERVICE_BASE_URL=http://localhost:9999
```

**3. Start your app and trigger the flow as usual.**

**4. Check the peekr terminal:**

```
================================================================================
[#1] 2025-01-15T20:30:00.000Z  POST /api/user/v1/upsert
================================================================================

--- Headers ---
{ "content-type": "application/json", "x-api-key": "..." }

--- Payload ---
{
  "users": [
    {
      "identifiers": { "email": "user@example.com" },
      "attributes": { "custom": { "person_key": "PK-12345" } }
    }
  ]
}

--- Response 200 ---
{ "data": { "successful": { "count": 1 } } }
================================================================================
```

**5. Restore the original URL and stop peekr.**

## Requirements

- Node.js >= 18
- No npm dependencies
