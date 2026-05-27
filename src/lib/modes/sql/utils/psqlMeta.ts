// Translate psql-style and sqlite-shell-style meta-commands into real SQL
// before they hit the engine. Keeps `\dt`, `\d users`, `.tables`, etc.
// working in the editor the way a terminal user expects them to.
//
// This is a *transparent* rewrite: the user types `\dt`, the engine
// receives the equivalent information_schema / sqlite_master query, and
// the result panel shows the rows the same way as any other SELECT.
//
// Returns `null` if the input isn't a known meta-command — caller should
// then pass the original query through unchanged.

import { parserProfileFor } from '../dialects';

const PG_SYS_SCHEMAS = "'pg_catalog', 'information_schema', 'pg_toast'";

function escapeLit(s: string): string {
  return s.replace(/'/g, "''");
}

function splitQualified(raw: string): { schema: string | null; name: string } {
  const trimmed = raw.trim().replace(/^"|"$/g, '');
  const dot = trimmed.indexOf('.');
  if (dot < 0) return { schema: null, name: trimmed };
  return {
    schema: trimmed.slice(0, dot).replace(/^"|"$/g, ''),
    name: trimmed.slice(dot + 1).replace(/^"|"$/g, ''),
  };
}

function translatePostgres(cmd: string, args: string): string | null {
  const a = args.trim();
  switch (cmd) {
    case 'dt':
    case 'dt+': {
      const like = a
        ? ` AND table_name ${a.includes('*') || a.includes('%') ? 'LIKE' : '='} '${escapeLit(a.replace(/\*/g, '%'))}'`
        : '';
      return `SELECT table_schema AS schema, table_name AS name, table_type AS type
              FROM information_schema.tables
              WHERE table_schema NOT IN (${PG_SYS_SCHEMAS})
                AND table_type = 'BASE TABLE'${like}
              ORDER BY table_schema, table_name`;
    }
    case 'dv':
    case 'dv+': {
      const like = a
        ? ` AND table_name ${a.includes('*') || a.includes('%') ? 'LIKE' : '='} '${escapeLit(a.replace(/\*/g, '%'))}'`
        : '';
      return `SELECT table_schema AS schema, table_name AS name
              FROM information_schema.views
              WHERE table_schema NOT IN (${PG_SYS_SCHEMAS})${like}
              ORDER BY table_schema, table_name`;
    }
    case 'dn':
    case 'dn+':
      return `SELECT schema_name AS name, schema_owner AS owner
              FROM information_schema.schemata
              WHERE schema_name NOT IN (${PG_SYS_SCHEMAS})
              ORDER BY schema_name`;
    case 'df':
    case 'df+':
      return `SELECT n.nspname AS schema,
                     p.proname AS name,
                     pg_catalog.pg_get_function_result(p.oid) AS result,
                     pg_catalog.pg_get_function_arguments(p.oid) AS arguments
              FROM pg_catalog.pg_proc p
              LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN (${PG_SYS_SCHEMAS})
              ORDER BY 1, 2`;
    case 'l':
    case 'l+':
      return `SELECT datname AS name,
                     pg_catalog.pg_get_userbyid(datdba) AS owner,
                     pg_catalog.pg_encoding_to_char(encoding) AS encoding
              FROM pg_catalog.pg_database
              WHERE datistemplate = false
              ORDER BY datname`;
    case 'du':
    case 'du+':
      return `SELECT rolname AS name,
                     rolsuper AS superuser,
                     rolcreaterole AS create_role,
                     rolcreatedb AS create_db,
                     rolcanlogin AS can_login
              FROM pg_catalog.pg_roles
              WHERE rolname NOT LIKE 'pg_%'
              ORDER BY rolname`;
    case 'd':
    case 'd+': {
      if (!a) {
        // \d with no arg — list everything (tables, views, sequences)
        return `SELECT table_schema AS schema, table_name AS name, table_type AS type
                FROM information_schema.tables
                WHERE table_schema NOT IN (${PG_SYS_SCHEMAS})
                ORDER BY table_schema, table_name`;
      }
      const { schema, name } = splitQualified(a);
      const schemaClause = schema ? ` AND table_schema = '${escapeLit(schema)}'` : '';
      return `SELECT column_name AS column,
                     data_type AS type,
                     is_nullable AS nullable,
                     column_default AS default
              FROM information_schema.columns
              WHERE table_name = '${escapeLit(name)}'${schemaClause}
              ORDER BY ordinal_position`;
    }
  }
  return null;
}

function translateSqlite(cmd: string, args: string): string | null {
  const a = args.trim();
  switch (cmd) {
    case 'tables':
      return `SELECT name, type FROM sqlite_master
              WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
              ORDER BY name`;
    case 'schema': {
      if (!a) {
        return `SELECT name, sql FROM sqlite_master
                WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                ORDER BY name`;
      }
      // .schema users → PRAGMA table_info(users), prettied up
      return `SELECT name AS column, type, "notnull" AS not_null, dflt_value AS default_value, pk
              FROM pragma_table_info('${escapeLit(a)}')`;
    }
    case 'databases':
      return `PRAGMA database_list`;
    case 'indexes':
      if (!a) return null;
      return `SELECT * FROM pragma_index_list('${escapeLit(a)}')`;
  }
  return null;
}

/**
 * Try to translate a meta-command for the given driver. Returns the
 * substitute SQL, or `null` if the input isn't a meta-command we know how
 * to rewrite. Callers should send the original query through unchanged
 * when `null` is returned.
 */
export function translateMetaCommand(query: string, driver: string): string | null {
  const trimmed = query.trim().replace(/;+\s*$/, '');
  if (!trimmed) return null;

  const profile = parserProfileFor(driver);

  if (trimmed.startsWith('\\') && profile === 'PostgreSQL') {
    const m = trimmed.match(/^\\(\S+)\s*(.*)$/);
    if (!m) return null;
    return translatePostgres(m[1], m[2] ?? '');
  }

  if (trimmed.startsWith('.') && profile === 'SQLite') {
    const m = trimmed.match(/^\.(\S+)\s*(.*)$/);
    if (!m) return null;
    return translateSqlite(m[1], m[2] ?? '');
  }

  return null;
}
