import { createRuntime, migrate } from '../tests/sites/harness.mjs';
const runtime = await createRuntime({
  port: Number(process.env.YORU_E2E_PORT || 5187),
  assets: true,
});
await migrate(runtime);
console.log(`Yoru Sites test server ready at ${await runtime.ready}`);
async function stop() {
  await runtime.dispose();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
