// Integration tests for endpoints that touch the database.
import request from "supertest";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import app from "../src/app.js";
import { pool } from "../src/db.js";

// Before each test: clean the tables so every test starts from a known state.
beforeEach(async () => {
  // TRUNCATE ... CASCADE resets the tables (and RESTART IDENTITY resets the id counter).
  await pool.query("TRUNCATE users, tasks RESTART IDENTITY CASCADE");
});

// After all tests: close the pool so the process can exit cleanly.
afterAll(async () => {
  await pool.end();
});

describe("POST /auth/register", () => {
  it("creates a user and returns 201", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ username: "alice", password: "secret123" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: "alice", role: "user" });
  });

  it("rejects duplicate username with 409", async () => {
    await request(app).post("/auth/register").send({ username: "bob", password: "x" });
    const res = await request(app).post("/auth/register").send({ username: "bob", password: "x" });
    expect(res.status).toBe(409);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(app).post("/auth/register").send({ username: "nopass" });
    expect(res.status).toBe(400);
  });
});
