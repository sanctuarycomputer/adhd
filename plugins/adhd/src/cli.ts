const [, , command, ...rest] = process.argv;

export function fail(message: string, fixup?: string): never {
  console.error(`✗ ${message}`);
  if (fixup) console.error(`  → ${fixup}`);
  process.exit(1);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {};

async function main() {
  const handler = command ? commands[command] : undefined;
  if (!handler) fail(`Unknown command: ${command ?? "(none)"}`, "Available: (none yet)");
  await handler(rest);
}
main();
