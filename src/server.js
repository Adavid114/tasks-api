// Entry point. This is the single process that systemd will supervise.
// It creates the HTTP server, wires the routes, and handles clean shutdown.

// Load .env for local/by-hand runs. Under systemd the environment comes
// from the unit file (EnvironmentFile=), and this line simply finds no .env
// on the server and does nothing.
require("dotenv").config();

const express = require("express");
const { query, pool } = require("./db");
const {
  hashPassword,
  verifyPassword,
  signToken,
  authenticate,
  requireRole,
} = require("./auth");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());

// One-line request log to STDOUT. The app opens no log file: it writes to
// stdout/stderr and lets the supervisor (systemd -> journald) capture it.
// `journalctl -u tasks-api` will show these lines.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`
    );
  });
  next();
});

// --- Health check (used later by Nginx and monitoring) ---
app.get("/health", (req, res) => res.json({ status: "ok" }));

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
    console.error("register failed:", err.message);
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
    console.error("login failed:", err.message);
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

// Start listening. Keep the server handle so shutdown can close it.
const server = app.listen(PORT, HOST, () => {
  // PID and bind address at startup: this is what you match against
  // `ps`, `ss -ltnp` and `systemctl status`.
  console.log(`tasks-api listening on ${HOST}:${PORT} (pid ${process.pid})`);
});

// --- Graceful shutdown ---
// systemd stops a service by sending SIGTERM (then SIGKILL after a timeout).
// We stop accepting new connections and close the DB pool so the process
// exits cleanly on its own. This is the same signal Docker sends on
// `docker stop`, so the behaviour carries forward to later phases.
function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(async () => {
    await pool.end();
    console.log("closed http server and db pool, exiting");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
