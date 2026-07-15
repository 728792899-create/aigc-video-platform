import Database = require('better-sqlite3')
import type initSqlJs from 'sql.js'
import fs from 'node:fs'

export type RuntimeSqlValue = string | number | Uint8Array | null
export type RuntimeSqlRow = Record<string, RuntimeSqlValue>

export interface RuntimeResultSet {
  columns: string[]
  values: RuntimeSqlValue[][]
}

export interface RuntimeStatement {
  bind(values: RuntimeSqlValue[]): void
  step(): boolean
  getAsObject(): RuntimeSqlRow
  free(): void
}

export interface RuntimeDatabase {
  readonly driver: 'sqljs' | 'better-sqlite3'
  _txDepth: number
  run(sql: string): void
  exec(sql: string): RuntimeResultSet[]
  prepare(sql: string): RuntimeStatement
  export(): Uint8Array
  configurePersistentMode(): void
  checkpoint(): void
  close(): void
}

class SqlJsRuntime implements RuntimeDatabase {
  readonly driver = 'sqljs' as const
  _txDepth = 0

  constructor(private readonly database: initSqlJs.Database) {}

  run(sql: string): void {
    this.database.run(sql)
  }

  exec(sql: string): RuntimeResultSet[] {
    return this.database.exec(sql) as RuntimeResultSet[]
  }

  prepare(sql: string): RuntimeStatement {
    return this.database.prepare(sql)
  }

  export(): Uint8Array {
    return this.database.export()
  }

  configurePersistentMode(): void {
    this.database.run('PRAGMA foreign_keys = ON')
  }

  checkpoint(): void {
    // sql.js persists through export() in the database facade.
  }

  close(): void {
    this.database.close()
  }
}

class BetterStatement implements RuntimeStatement {
  private readonly statement: Database.Statement<RuntimeSqlValue[], RuntimeSqlRow>
  private params: RuntimeSqlValue[] = []
  private rows: RuntimeSqlRow[] | null = null
  private rowIndex = -1
  private executed = false

  constructor(database: Database.Database, sql: string) {
    this.statement = database.prepare<RuntimeSqlValue[], RuntimeSqlRow>(sql)
  }

  bind(values: RuntimeSqlValue[]): void {
    this.params = values
  }

  step(): boolean {
    if (!this.executed) {
      this.executed = true
      if (this.statement.reader) this.rows = this.statement.all(...this.params)
      else this.statement.run(...this.params)
    }
    if (!this.rows) return false
    this.rowIndex += 1
    return this.rowIndex < this.rows.length
  }

  getAsObject(): RuntimeSqlRow {
    return this.rows?.[this.rowIndex] || {}
  }

  free(): void {
    this.rows = null
    this.params = []
  }
}

class BetterSqliteRuntime implements RuntimeDatabase {
  readonly driver = 'better-sqlite3' as const
  _txDepth = 0
  private readonly database: Database.Database

  constructor(private readonly filename: string) {
    this.database = new Database(filename, { timeout: 5_000 })
  }

  run(sql: string): void {
    this.database.exec(sql)
  }

  exec(sql: string): RuntimeResultSet[] {
    const statement = this.database.prepare<RuntimeSqlValue[], RuntimeSqlRow>(sql)
    if (!statement.reader) {
      statement.run()
      return []
    }
    const columns = statement.columns().map((column) => column.name)
    const rows = statement.all()
    return [{
      columns,
      values: rows.map((row) => columns.map((column) => row[column] ?? null)),
    }]
  }

  prepare(sql: string): RuntimeStatement {
    return new BetterStatement(this.database, sql)
  }

  export(): Uint8Array {
    this.checkpoint()
    return new Uint8Array(fs.readFileSync(this.filename))
  }

  configurePersistentMode(): void {
    this.database.pragma('foreign_keys = ON')
    this.database.pragma('busy_timeout = 5000')
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = NORMAL')
  }

  checkpoint(): void {
    if (!this.database.open) return
    this.database.pragma('wal_checkpoint(FULL)')
  }

  close(): void {
    this.database.close()
  }
}

export function createSqlJsRuntime(database: initSqlJs.Database): RuntimeDatabase {
  return new SqlJsRuntime(database)
}

export function createBetterSqliteRuntime(filename: string): RuntimeDatabase {
  return new BetterSqliteRuntime(filename)
}
