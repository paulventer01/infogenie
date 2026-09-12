import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { closePools } from "./db/pool.js";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`InfoGenie platform (Phase 0) listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      closePools().finally(() => process.exit(0));
    });
  });
}
