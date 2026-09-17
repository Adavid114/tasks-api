const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "tasks-api" },
  // Emit the level as its text label ("info","error") instead of a number,
  // so Grafana/Loki can filter and color by severity.
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.jwtSecret",
    ],
    censor: "[REDACTED]",
  },
});

module.exports = logger;
