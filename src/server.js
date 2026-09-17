// Production entry point: import the app and start listening.
require("dotenv").config();
const app = require("./app");
const { pool } = require("./db");
const logger = require("./logger");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT, pid: process.pid }, "tasks-api listening");
});

// Graceful shutdown (SIGTERM/SIGINT)
function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await pool.end();
    logger.info("closed http server and db pool, exiting");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
