#!/bin/bash
set -euo pipefail

# Runs at DB initialization, executed as the POSTGRES_USER (postgres superuser).
# psql connects via the local socket as postgres, no password needed here.
# We create the schema (owned by postgres) and a limited application role.

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Tables: owned by postgres (the current user), NOT by the app role.
    CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        username   TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        done       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

    -- Application role: limited, password from the environment variable.
    CREATE ROLE tasks_app WITH LOGIN PASSWORD '${PGPASSWORD}';

    -- Only what the app needs: connect + use schema + DML on existing tables.
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO tasks_app;
    GRANT USAGE ON SCHEMA public TO tasks_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tasks_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tasks_app;

    -- Future-proof: same DML on tables/sequences created LATER, automatically.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tasks_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO tasks_app;
EOSQL
