// Express app definition: middleware and routes. Exported so both the
// production server (server.js) and the tests can use it without opening a port.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { query } = require("./db");
const {
  hashPassword,
  verifyPassword,
  signToken,
  authenticate,
  requireRole,
} = require("./auth");
const logger = require("./logger");
const { register, httpRequestsTotal, httpRequestDuration } = require("./metrics");

const app = express();

// Behind Nginx: trust the proxy so X-Forwarded-For gives the real client IP
// (needed for rate limiting to count per real client, not per proxy).
app.set("trust proxy", 1);

app.use(express.json());

// Metrics + logging middleware: times each request and records it on finish.
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    end(labels);
    logger.info({ method: req.method, route: req.path, status: res.statusCode }, "request");
  });
  next();
});

// Rate limiter for auth endpoints: protects against brute-force and abuse.
// Stricter than general traffic because these are the sensitive endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requests per IP per window
  standardHeaders: true, // send RateLimit-* headers
  legacyHeaders: false,
  message: { error: "too many requests, try again later" },
});

// --- Health check ---
app.get("/health", (req, res) => res.json({ status: "healthy" }));

// --- Metrics endpoint (internal, scraped by Prometheus) ---
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// --- Auth: register (rate limited) ---
app.post("/auth/register", authLimiter, async (req, res) => {
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
    if (err.code === "23505") {
      return res.status(409).json({ error: "username already exists" });
    }
    logger.error({ err: err.message }, "register failed");
    return res.status(500).json({ error: "internal error" });
  }
});

// --- Auth: login (rate limited) ---
app.post("/auth/login", authLimiter, async (req, res) => {
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
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    return res.json({ token: signToken(user) });
  } catch (err) {
    logger.error({ err: err.message }, "login failed");
    return res.status(500).json({ error: "internal error" });
  }
});

// --- Tasks CRUD (require a valid token) ---
app.get("/tasks", authenticate, async (req, res) => {
  const result = await query(
    "SELECT id, title, done, created_at FROM tasks WHERE user_id = $1 ORDER BY id",
    [req.user.sub]
  );
  res.json(result.rows);
});

app.post("/tasks", authenticate, async (req, res) => {
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const result = await query(
    "INSERT INTO tasks (user_id, title) VALUES ($1, $2) RETURNING id, title, done, created_at",
    [req.user.sub, title]
  );
  res.status(201).json(result.rows[0]);
});

app.put("/tasks/:id", authenticate, async (req, res) => {
  const { title, done } = req.body || {};
  const result = await query(
    `UPDATE tasks SET title = COALESCE($1, title), done = COALESCE($2, done)
      WHERE id = $3 AND user_id = $4
      RETURNING id, title, done, created_at`,
    [title ?? null, done ?? null, req.params.id, req.user.sub]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "not found" });
  res.json(result.rows[0]);
});

app.delete("/tasks/:id", authenticate, async (req, res) => {
  const result = await query(
    "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.sub]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// --- Admin-only ---
app.get("/admin/tasks", authenticate, requireRole("admin"), async (req, res) => {
  const result = await query(
    "SELECT id, user_id, title, done, created_at FROM tasks ORDER BY id"
  );
  res.json(result.rows);
});

module.exports = app;
