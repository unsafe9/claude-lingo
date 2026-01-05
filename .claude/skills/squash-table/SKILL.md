---
name: squash-table
description: Squash database table migration versions in server/src/database.ts. Consolidates multiple migrations into a single initial migration while preserving the final schema.
---

# Squash Database Migrations

## Purpose

This skill helps consolidate multiple database migrations into a single migration when the schema has stabilized. This is useful during development to clean up migration history.

## Target File

`server/src/database.ts`

## How to Use

Tell Claude what changes to make, for example:
- "Squash all migrations into a single initial migration"
- "Combine migrations 1-3 into one"
- "Reset migrations to version 1 with current schema"

## What This Skill Does

1. **Read** `server/src/database.ts` to understand current migrations and schema
2. **Consolidate schema** into a single migration (version 1)
3. **Update the MIGRATIONS array** with the squashed version

## Important Notes

- **Data Loss Warning**: Squashing migrations requires resetting the database
- After squashing, delete the existing database: `rm ~/.config/lingo/data.db`
- The new single migration will recreate the schema from scratch
