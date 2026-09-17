// Prometheus metrics for the app (application-level Golden Signals).
const client = require("prom-client");

// The registry holds all metrics. Default metrics = Node process stats
// (memory, event loop lag, GC) — free, like node-exporter's go_* metrics.
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// COUNTER: total HTTP requests. Labels make one metric cover traffic AND
// errors: rate() over all = traffic; ratio of status_code=~"5.." = error rate.
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// HISTOGRAM: request duration → enables p50/p95/p99 via histogram_quantile().
// Buckets are latency thresholds in seconds, tuned for a fast API.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

module.exports = { register, httpRequestsTotal, httpRequestDuration };
