import { readConfig, inspectConfig } from "./config.ts";
import { startApp } from "./app.ts";
const [command, path] = process.argv.slice(2);
try {
  if (!["inspect", "run"].includes(command) || !path)
    throw new Error("usage: node src/main.ts <inspect|run> <config.json>");
  const config = await readConfig(path);
  if (command === "inspect")
    process.stdout.write(`${JSON.stringify(inspectConfig(config), null, 2)}\n`);
  else {
    const controller = new AbortController();
    let stop = () => controller.abort();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => stop());
    const app = await startApp(config, { signal: controller.signal });
    stop = () => {
      void app.stop().catch(error => {
        process.stderr.write(`${error}\n`);
        process.exitCode = 1;
      });
    };
    process.stdout.write(`${JSON.stringify({ asset_id: app.asset_id })}\n`);
    void app.done.catch((error) => {
      process.stderr.write(`${error}\n`);
      process.exitCode = 1;
    });
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "configuration failed"}\n`,
  );
  process.exitCode = 1;
}
