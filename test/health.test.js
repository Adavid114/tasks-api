// Integration tests for endpoints that don't touch the database.
import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../src/app.js";

describe("GET /health", () => {
  it("returns 200 and healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "healthy" });
  });
});

describe("auth without token", () => {
  it("POST /tasks without token returns 401", async () => {
    const res = await request(app).post("/tasks").send({ title: "x" });
    expect(res.status).toBe(401);
  });
});
