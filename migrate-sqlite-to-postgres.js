const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_PATH = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, 'complaints.db'));
const TABLES = [
  {
    name: 'admins',
    requiredColumns: ['id', 'email', 'password', 'name'],
    columns: ['id', 'email', 'password', 'name', 'can_create_admins', 'created_at']
  },
  {
    name: 'complaints',
    requiredColumns: ['id', 'reference_code', 'category', 'content'],
    columns: [
      'id', 'reference_code', 'category', 'content', 'status', 'priority',
      'sentiment', 'submitted_at'
    ]
  },
  {
    name: 'admin_preferences',
    requiredColumns: ['admin_id'],
    columns: ['admin_id', 'theme', 'accent', 'density', 'avatar_data_url']
  },
  {
    name: 'admin_login_otps',
    requiredColumns: ['admin_id', 'code_hash', 'expires_at', 'created_at'],
    columns: ['admin_id', 'code_hash', 'expires_at', 'created_at', 'attempts']
  }
];

async function migrate() {
  if (!DATABASE_URL) {
    throw new Error('Set DATABASE_URL to the target PostgreSQL connection string.');
  }
  if (!fs.existsSync(SQLITE_PATH)) {
    throw new Error(`SQLite source database does not exist: ${SQLITE_PATH}`);
  }

  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const postgres = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: true }
  });

  try {
    await postgres.connect();
    await postgres.query('BEGIN');
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        can_create_admins INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        reference_code TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Unreviewed',
        priority TEXT NOT NULL DEFAULT 'Medium',
        sentiment TEXT NOT NULL DEFAULT 'Neutral',
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS admin_preferences (
        admin_id INTEGER PRIMARY KEY,
        theme TEXT NOT NULL DEFAULT 'light',
        accent TEXT NOT NULL DEFAULT 'orange',
        density TEXT NOT NULL DEFAULT 'comfortable',
        avatar_data_url TEXT
      )
    `);
    await postgres.query(`
      CREATE TABLE IF NOT EXISTS admin_login_otps (
        admin_id INTEGER PRIMARY KEY,
        code_hash TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      )
    `);
    const imported = {};
    const sourceTables = new Set(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name)
    );

    for (const table of TABLES) {
      if (!sourceTables.has(table.name)) {
        imported[table.name] = { read: 0, inserted: 0, skipped: true };
        continue;
      }

      const sourceColumns = new Set(
        sqlite.prepare(`PRAGMA table_info("${table.name}")`).all().map(column => column.name)
      );
      const columnsToImport = table.columns.filter(column => sourceColumns.has(column));
      const missingRequiredColumns = table.requiredColumns.filter(column => !sourceColumns.has(column));
      if (missingRequiredColumns.length > 0) {
        throw new Error(
          `SQLite table ${table.name} is missing required columns: ${missingRequiredColumns.join(', ')}`
        );
      }

      const columns = columnsToImport.join(', ');
      const placeholders = columnsToImport.map((_, index) => `$${index + 1}`).join(', ');
      const statement = postgres.query.bind(postgres);
      const rows = sqlite.prepare(`SELECT ${columns} FROM ${table.name}`).iterate();
      let read = 0;
      let inserted = 0;

      for (const row of rows) {
        const values = columnsToImport.map(column => row[column] ?? null);
        const result = await statement(
          `INSERT INTO ${table.name} (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
        read += 1;
        inserted += result.rowCount;
      }
      imported[table.name] = { read, inserted, skipped: false };

      if (sourceColumns.has('id')) {
        await postgres.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table.name}`,
          [table.name]
        );
      }
    }

    await postgres.query('COMMIT');
    for (const [table, result] of Object.entries(imported)) {
      if (result.skipped) {
        console.log(`Skipped ${table}: it is not present in the SQLite backup.`);
      } else {
        console.log(`${table}: ${result.inserted} of ${result.read} row(s) imported; existing rows were left unchanged.`);
      }
    }
    console.log('SQLite data import completed.');
  } catch (error) {
    try {
      await postgres.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to roll back the PostgreSQL import:', rollbackError);
    }
    throw error;
  } finally {
    sqlite.close();
    await postgres.end();
  }
}

migrate().catch(error => {
  console.error('SQLite to PostgreSQL migration failed:', error);
  process.exitCode = 1;
});
