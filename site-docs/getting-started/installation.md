# Installation

## Prerequisites

- **Node.js >= 18** — peekr uses modern Node.js APIs (`fetch`, ESM loaders, `node:http`). Check your version:

```bash
node --version
# v18.0.0 or higher
```

No other tools or dependencies are required.

## Global install (recommended)

Install once, use anywhere:

```bash
npm install -g @marcosreuquen/peekr
```

Verify it works:

```bash
peekr --help
```

You should see:

```
peekr --target <host> [options]    Standalone proxy mode
peekr run [options] -- <command>   Spawn app with auto-interception
peekr ui [options] [-- <command>]  Live web dashboard
```

## Run with npx (no install)

If you prefer not to install globally, use `npx` to run peekr directly:

```bash
npx @marcosreuquen/peekr --help
npx @marcosreuquen/peekr run -- node server.mjs
npx @marcosreuquen/peekr ui --app-port 3000 -- npm run dev
```

This downloads peekr on first use and caches it locally.

## Project-level install

You can also add peekr as a dev dependency:

```bash
npm install -D @marcosreuquen/peekr
```

Then use it in `package.json` scripts:

```json
{
  "scripts": {
    "dev:debug": "peekr run -- npm run start:dev",
    "dev:ui": "peekr ui --app-port 3000 -- npm run start:dev"
  }
}
```

## Next steps

Head to the [Quick Start](quick-start.md) to try each mode hands-on.
