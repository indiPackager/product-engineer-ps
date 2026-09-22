import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { Scheduler, MemoryDestination } from "./scheduler.js";
import { Storage } from "./storage.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const storage = await new Storage(join(root, "data", "reminders.json")).open();
const scheduler = new Scheduler({
  storage,
  destination: new MemoryDestination(),
});
await scheduler.recover();
const app = createApp(scheduler);
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () =>
  console.log(`Durable reminders server running at http://localhost:${port}`),
);
