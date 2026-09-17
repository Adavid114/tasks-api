// Express app definition: middleware and routes. Exported so both the
// production server (server.js) and the tests can use it without opening a port.

// Load .env for local/by-hand runs. Under systemd the environment comes
// from the unit file (EnvironmentFile=), and this line simply finds no .env
// on the server and does nothing.
require("dotenv").config();

const express = require("express");
const { query } = require("./db");
const {
  hashPassword,
  verifyPassword,
  signToken,
  authenticate,
  requireRole,
} = require("./auth");
const { register, httpRequestsTotal, httpRequestDuration } = require("./metrics");
const logger = require("./logger");

const app = express();
app.use(express.json());

// Metrics + logging middleware: times each request and records it on finish.
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    end(labels);
    // Structured request log: level + fields instead of a text string.
    logger.info({ method: req.method, route: req.path, status: res.statusCode }, "request");
  });
  next();
});

// --- Health check (used later by Nginx and monitoring) ---
app.get("/health", (req, res) => res.json({ status: "healthy" }));

// Metrics endpoint for Prometheus. Internal only (not proxied by nginx).
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// --- Auth: register ---
app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  try {
    const hash = await hashPassword(password);
    const result = await query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, role",
      [username, hash]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // 23505 = unique_violation (username already taken)
    if (err.code === "23505") {
      return res.status(409).json({ error: "username already exists" });
    }
    logger.error({ err: err.message }, "register failed");
    return res.status(500).json({ error: "internal error" });
  }
});

// --- Auth: login ---
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  try {
    const result = await query(
      "SELECT id, username, password, role FROM users WHERE username = $1",
      [username]
    );
    const user = result.rows[0];
    // Same response whether the user is missing or the password is wrong, so
    // we do not leak which usernames exist.
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    return res.json({ token: signToken(user) });
  } catch (err) {
    logger.error({ err: err.message }, "login failed");
    return res.status(500).json({ error: "internal error" });
  }
});

// --- Tasks CRUD (all require a valid token) ---

// List my tasks.
app.get("/tasks", authenticate, async (req, res) => {
  const result = await query(
    "SELECT id, title, done, created_at FROM tasks WHERE user_id = $1 ORDER BY id",
    [req.user.sub]
  );
  res.json(result.rows);
});

// Create a task owned by me.
app.post("/tasks", authenticate, async (req, res) => {
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const result = await query(
    "INSERT INTO tasks (user_id, title) VALUES ($1, $2) RETURNING id, title, done, created_at",
    [req.user.sub, title]
  );
  res.status(201).json(result.rows[0]);
});

// Update one of my tasks (title and/or done).
app.put("/tasks/:id", authenticate, async (req, res) => {
  const { title, done } = req.body || {};
  const result = await query(
    `UPDATE tasks
        SET title = COALESCE($1, title),
            done  = COALESCE($2, done)
      WHERE id = $3 AND user_id = $4
      RETURNING id, title, done, created_at`,
    [title ?? null, done ?? null, req.params.id, req.user.sub]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "not found" });
  res.json(result.rows[0]);
});

// Delete one of my tasks.
app.delete("/tasks/:id", authenticate, async (req, res) => {
  const result = await query(
    "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.sub]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// --- Admin-only: list every task in the system, regardless of owner. ---
// The one route that uses the role check, so there is something to exercise
// authorization with (and to attack later in the offensive phase).
app.get("/admin/tasks", authenticate, requireRole("admin"), async (req, res) => {
  const result = await query(
    "SELECT id, user_id, title, done, created_at FROM tasks ORDER BY id"
  );
  res.json(result.rows);
});

module.exports = app
