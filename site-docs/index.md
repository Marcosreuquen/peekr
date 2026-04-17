# peekr

**Zero-dependency HTTP capture proxy for Node.js.**

Intercept, inspect, and manipulate HTTP traffic from any Node.js application — no code changes, no config files, no npm dependencies. Just Node.js stdlib.

---

## Why peekr?

- **Zero dependencies** — runs on Node.js >= 18 with nothing to install beyond peekr itself
- **Three capture modes** — standalone proxy, automatic child-process interception, or a full live dashboard
- **Dynamic rules engine** — block or mock requests on the fly, no restarts needed
- **Live web dashboard** — dark-themed UI with real-time SSE updates, request cards, and collapsible details
- **Child process log capture** — see your app's stdout/stderr alongside HTTP traffic

---

## Quick install

```bash
npm install -g @marcosreuquen/peekr
```

Or run without installing:

```bash
npx @marcosreuquen/peekr --help
```

---

## Quick example

Intercept all outgoing HTTP calls from your Node.js app — zero config:

```bash
peekr run -- npm run start:dev
```

That's it. Every outgoing HTTP/HTTPS request your app makes is logged to the terminal. No `.env` changes, no code changes.

Want a live dashboard instead?

```bash
peekr ui --app-port 3000 -- npm run start:dev
```

Open [http://localhost:49997](http://localhost:49997) to see requests appear in real time.

---

## Three modes at a glance

| Mode | Command | Best for |
|------|---------|----------|
| **Proxy** | `peekr --target api.example.com` | Quick inspection — point your app at the proxy manually |
| **Run** | `peekr run -- <command>` | Automatic interception — no env changes needed |
| **UI** | `peekr ui [-- <command>]` | Full dashboard — incoming + outgoing traffic in a browser |

---

## Next steps

- [Installation](getting-started/installation.md) — prerequisites and install options
- [Quick Start](getting-started/quick-start.md) — hands-on walkthrough of each mode
