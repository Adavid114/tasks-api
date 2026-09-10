// Database access layer using node-postgres (pg) directly, no ORM.
// A single connection Pool is shared across the whole process. Each query
// borrows a client from the pool and returns it automatically when done.

const { Pool } = require("pg");

// pg reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the environment
// automatically, so no credentials are hardcoded here.
const pool = new Pool();

// Small helper so the route code stays readable. Every query is
// parameterized ($1, $2, ...): the values travel separately from the SQL
// text, which is what prevents SQL injection. (We will deliberately break
// this in the offensive phase to see the difference first-hand.)
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
