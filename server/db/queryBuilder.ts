import knexFactory, { type Knex } from 'knex'

export interface CompiledQuery {
  sql: string
  bindings: readonly unknown[]
}

// Knex is used as a provider-neutral SQL compiler. The existing DbClient owns
// the connection and transaction, so this layer never opens a second SQLite
// connection or bypasses the selected sql.js/better-sqlite3 runtime driver.
const compiler = knexFactory({ client: 'better-sqlite3', useNullAsDefault: true })

export function table(name: string): Knex.QueryBuilder {
  return compiler(name)
}

export function compile(query: Knex.QueryBuilder): CompiledQuery {
  const statement = query.toSQL().toNative()
  return { sql: statement.sql, bindings: statement.bindings }
}
