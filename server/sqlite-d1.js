import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const WRITE_SQL = /^(?:\s|--.*?\n|\/\*[\s\S]*?\*\/)*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA\s+\w+\s*=|VACUUM|BEGIN|COMMIT|ROLLBACK)/i;

const ensureDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

const toMeta = (db) => {
  const [{ values = [[0]] } = {}] = db.exec('SELECT changes()');
  const [{ values: rowIdValues = [[0]] } = {}] = db.exec('SELECT last_insert_rowid()');
  return {
    changes: Number(values[0]?.[0] || 0),
    last_row_id: Number(rowIdValues[0]?.[0] || 0)
  };
};

class SqlJsStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async run() {
    this.database.run(this.sql, this.params);
    if (WRITE_SQL.test(this.sql)) this.database.persist();
    return {
      success: true,
      meta: toMeta(this.database.db)
    };
  }

  async all() {
    const statement = this.database.db.prepare(this.sql);
    const results = [];
    try {
      statement.bind(this.params);
      while (statement.step()) {
        results.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return { results };
  }

  async first() {
    const { results } = await this.all();
    return results[0] || null;
  }
}

export class SqlJsD1Database {
  constructor(SQL, dbPath) {
    this.SQL = SQL;
    this.dbPath = dbPath;
    this.db = fs.existsSync(dbPath)
      ? new SQL.Database(fs.readFileSync(dbPath))
      : new SQL.Database();
  }

  prepare(sql) {
    return new SqlJsStatement(this, sql);
  }

  run(sql, params = []) {
    this.db.run(sql, params);
  }

  exec(sql) {
    this.db.exec(sql);
    this.persist();
  }

  persist() {
    ensureDir(this.dbPath);
    const data = this.db.export();
    const tempPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tempPath, Buffer.from(data));
    fs.renameSync(tempPath, this.dbPath);
  }

  close() {
    this.persist();
    this.db.close();
  }
}

const getAppliedMigrationNames = (database) => {
  database.run(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const rows = database.db.exec('SELECT name FROM _migrations ORDER BY name ASC');
  const values = rows[0]?.values || [];
  return new Set(values.map(([name]) => name));
};

const applyMigrations = (database, migrationsDir) => {
  const applied = getAppliedMigrationNames(database);
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && !file.startsWith('._'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    database.db.exec('BEGIN');
    try {
      database.db.exec(sql);
      database.db.run('INSERT INTO _migrations (name) VALUES (?)', [file]);
      database.db.exec('COMMIT');
    } catch (error) {
      database.db.exec('ROLLBACK');
      throw new Error(`Failed to apply migration ${file}: ${error.message}`);
    }
    console.log(`[sqlite] applied migration ${file}`);
  }

  database.persist();
};

export const createD1Database = async ({ dbPath, migrationsDir }) => {
  ensureDir(dbPath);
  const wasmPath = path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  });
  const database = new SqlJsD1Database(SQL, dbPath);
  applyMigrations(database, migrationsDir);
  console.log(`[sqlite] using independent database ${dbPath}`);
  return database;
};

export const describeD1Database = async (database) => {
  const course = await database.prepare('SELECT COUNT(*) AS count FROM courses').first();
  const lessons = await database.prepare('SELECT COUNT(*) AS count FROM lessons').first();
  const vocabulary = await database.prepare('SELECT COUNT(*) AS count FROM vocabulary').first();
  return {
    courses: Number(course?.count || 0),
    lessons: Number(lessons?.count || 0),
    vocabulary: Number(vocabulary?.count || 0)
  };
};

export const formatSqlForLog = (sql) => normalizeSql(sql).slice(0, 120);
