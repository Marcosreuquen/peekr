// lib/args.mjs
export function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export const hasFlag = (args, name) => args.includes(`--${name}`);
