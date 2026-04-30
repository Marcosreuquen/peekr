# Contributing

Thanks for your interest in contributing to peekr! This guide covers everything you need to get started.

## Prerequisites

- **Node.js >= 18**
- **git**

## Getting Started

```bash
# Clone the repository
git clone https://github.com/user/peekr.git
cd peekr

# Link the CLI globally for local development
npm link

# Run peekr
peekr --help
```

No `npm install` needed — peekr has zero dependencies.

## Project Structure

```
bin/peekr.mjs           CLI entry point and subcommand dispatch
lib/                    Core modules
  args.mjs              CLI argument parsing helpers
  child-runner.mjs      Child process management
  intercept-template.mjs  ESM/CJS loader generation for HTTP patching
  logger.mjs            Console logging with colors
  logs-command.mjs      `peekr logs` command
  proxy-core.mjs        Outgoing HTTP proxy server
  reverse-proxy.mjs     Incoming traffic reverse proxy
  rules-engine.mjs      Request matching and rules store
  run-command.mjs       `peekr run` command
  ui-command.mjs        `peekr ui` command
  ui-server.mjs         Dashboard server + SSE + REST API
ui/index.html           Single-file web dashboard
site-docs/              Documentation site source
```

## How to Add a New CLI Command

1. **Create the command module** at `lib/<name>-command.mjs`:

```js
// lib/example-command.mjs
import { getArg, hasFlag } from './args.mjs';

export async function exampleCommand(argv) {
  // Parse arguments
  const verbose = hasFlag(argv, '--verbose');

  // Implement your command
  console.log('Hello from example command');
}
```

2. **Register it in the CLI entry point** (`bin/peekr.mjs`):

```js
case 'example':
  const { exampleCommand } = await import('../lib/example-command.mjs');
  await exampleCommand(args);
  break;
```

3. **Update help text** in `bin/peekr.mjs` to include the new subcommand.

## Code Style

### Zero Dependencies

Do not add npm dependencies. Use Node.js built-in modules only. If you need functionality typically provided by a package, implement it with `node:*` modules.

### ESM Only

All source files use ES module syntax (`import`/`export`). The project has `"type": "module"` in `package.json`. The generated temporary CJS intercept is the only compatibility exception.

### No Build Step

The dashboard (`ui/index.html`) is a single file with inline CSS and JS. Do not introduce bundlers, transpilers, or build tools.

### General Guidelines

- Keep functions small and focused
- Use descriptive variable names
- Handle errors gracefully — peekr is a CLI tool, so user-facing errors should be clear
- Use the `logger.mjs` utilities for console output with colors

## Testing Locally

```bash
# Test proxy mode
peekr --target https://jsonplaceholder.typicode.com

# Test run mode
peekr run -- node your-app.js

# Test UI mode
peekr ui -- node your-app.js

# Follow child process logs
peekr logs
```

## Submitting a Pull Request

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Test all three modes (proxy, run, ui) to ensure nothing is broken
5. Commit with a clear message: `git commit -m "feat: add example feature"`
6. Push and open a PR against `main`

### Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `refactor:` — code refactoring
- `chore:` — maintenance tasks

### PR Checklist

- [ ] Zero new dependencies
- [ ] ESM syntax only
- [ ] All three modes tested manually
- [ ] Help text updated if adding/changing commands
