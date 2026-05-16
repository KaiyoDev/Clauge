//! Bootstrap `_sqlx_migrations` for databases that pre-date this migrator.
//!
//! Older Clauge alpha builds applied migrations via tauri-plugin-sql's
//! `add_migrations` plus a manual sqlx loop in `lib.rs` that re-ran every
//! boot. Neither tracked applied versions in `_sqlx_migrations`. Switching
//! to `sqlx::migrate!` without a bootstrap would cause it to attempt to
//! re-run V1–V7 against already-migrated schemas, hit "table already
//! exists" / "duplicate column" errors, roll back the per-migration
//! transaction, and fail.
//!
//! `seed_existing_install` runs ONCE before `MIGRATOR.run`:
//!   1. Create `_sqlx_migrations` if missing.
//!   2. State-B recovery: the old buggy v7 left `ssh_profiles_v7` populated
//!      and dropped `ssh_profiles`. Rename it back so probes see v5+ state.
//!   3. Probe each version's schema signature in order. For every version
//!      detected, INSERT a row in `_sqlx_migrations` with the migration's
//!      compile-time checksum so sqlx-migrate skips it.
//!   4. Stop probing at the first un-applied version (subsequent versions
//!      will be applied normally by `MIGRATOR.run`).
//!
//! Idempotent: no-op once `_sqlx_migrations` has any rows. Safe to call
//! every boot.

use sqlx::sqlite::SqlitePool;
use sqlx::Row;

/// Public entry point. See module docs.
pub async fn seed_existing_install(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), sqlx::Error> {
    create_migrations_table(pool).await?;

    let already_seeded: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(pool)
            .await?;
    if already_seeded > 0 {
        return Ok(());
    }

    // Fresh install with no prior schema → let MIGRATOR.run apply everything.
    if !table_exists(pool, "collections").await? {
        return Ok(());
    }

    recover_state_b(pool).await?;

    for migration in migrator.iter() {
        if !probe_version(pool, migration.version).await? {
            break;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO _sqlx_migrations \
             (version, description, installed_on, success, checksum, execution_time) \
             VALUES (?, ?, datetime('now'), 1, ?, 0)",
        )
        .bind(migration.version)
        .bind(migration.description.as_ref())
        .bind(migration.checksum.as_ref())
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// `_sqlx_migrations` schema mirrors what sqlx-migrate creates internally
/// for SQLite. Defining it explicitly here lets the bootstrap insert rows
/// before sqlx-migrate gets a chance to create the table itself.
async fn create_migrations_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The old hand-rolled v7 ran a destructive table-rebuild every boot via
/// the manual sqlx loop. When the final `RENAME ssh_profiles_v7 → ssh_profiles`
/// step failed silently, the database got stuck with profiles in
/// `ssh_profiles_v7` and no `ssh_profiles` table — invisible to the UI.
/// This recovers cleanly.
async fn recover_state_b(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let v7_exists = table_exists(pool, "ssh_profiles_v7").await?;
    let main_exists = table_exists(pool, "ssh_profiles").await?;

    if v7_exists && !main_exists {
        sqlx::query("ALTER TABLE ssh_profiles_v7 RENAME TO ssh_profiles")
            .execute(pool)
            .await?;
    } else if v7_exists && main_exists {
        // Defensive: both tables somehow coexist. Merge any unique _v7 rows
        // into main (main is canonical), then drop _v7.
        sqlx::query("INSERT OR IGNORE INTO ssh_profiles SELECT * FROM ssh_profiles_v7")
            .execute(pool)
            .await?;
        sqlx::query("DROP TABLE IF EXISTS ssh_profiles_v7")
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Each migration leaves a unique observable signature in the schema.
/// Detection is conservative — false-positives would skip a real
/// migration; false-negatives just cause a re-attempted apply that
/// `IF NOT EXISTS` / `OR IGNORE` patterns in our SQL safely no-op.
async fn probe_version(pool: &SqlitePool, version: i64) -> Result<bool, sqlx::Error> {
    Ok(match version {
        1 => table_exists(pool, "collections").await?,
        2 => column_exists(pool, "nosql_connections", "direct_connection").await?,
        3 => table_exists(pool, "ai_usage").await?,
        4 => table_exists(pool, "agent_sessions").await?,
        5 => table_exists(pool, "ssh_profiles").await?,
        6 => column_exists(pool, "sql_connections", "ssh_profile_id").await?,
        7 => ssh_profiles_check_includes_agent(pool).await?,
        8 => table_exists(pool, "explorer_connections").await?,
        _ => false,
    })
}

async fn table_exists(pool: &SqlitePool, name: &str) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
    )
    .bind(name)
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}

/// SQLite's `PRAGMA table_info` is a table-valued statement that doesn't
/// accept bound parameters, so the table name is interpolated. `table`
/// is always a hard-coded literal from `probe_version` — no user input,
/// no injection surface.
async fn column_exists(
    pool: &SqlitePool,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let rows = sqlx::query(&format!("PRAGMA table_info({})", table))
        .fetch_all(pool)
        .await?;
    for row in rows {
        let name: String = row.try_get("name")?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// v7 changed the `ssh_profiles.auth_type` CHECK constraint to allow
/// `'agent'`. The constraint isn't directly queryable, but the table's
/// `CREATE TABLE` SQL is stored verbatim in `sqlite_master.sql`.
async fn ssh_profiles_check_includes_agent(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='ssh_profiles'",
    )
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(sql.map(|s| s.contains("'agent'")).unwrap_or(false))
}

/// Idempotent one-time conversion of legacy single-key AI settings
/// (`ai_provider`, `ai_api_key_<provider>`) into rows in `ai_configurations`.
/// Guard: skips if `ai_configurations` already has any rows OR if a settings
/// row `ai:legacy_imported = "1"` is present.
pub async fn import_legacy_ai_settings(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Skip if already done.
    let existing_rows: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM ai_configurations").fetch_one(pool).await?;
    if existing_rows.0 > 0 {
        return Ok(());
    }
    let flag: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM settings WHERE key = 'ai:legacy_imported'",
    )
    .fetch_optional(pool)
    .await?;
    if flag.is_some() {
        return Ok(());
    }

    // Find every legacy `ai_api_key_<provider>` row with a non-empty value.
    let keys: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM settings WHERE key LIKE 'ai_api_key_%' AND value != ''",
    )
    .fetch_all(pool)
    .await?;

    let active_provider: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'ai_provider'",
    )
    .fetch_optional(pool)
    .await?;

    let mut first_id: Option<i64> = None;
    for (key, _value) in &keys {
        let provider = key.strip_prefix("ai_api_key_").unwrap_or("").to_string();
        if provider.is_empty() {
            continue;
        }
        let label = format!("My {}", cap_ai_provider(&provider));
        let res: (i64,) = sqlx::query_as(
            "INSERT INTO ai_configurations (label, provider, is_default)
             VALUES (?, ?, 0) RETURNING id",
        )
        .bind(&label)
        .bind(&provider)
        .fetch_one(pool)
        .await?;
        if first_id.is_none() {
            first_id = Some(res.0);
        }
    }

    // Mark the active-provider's row as default (if any), else first imported.
    if let Some(active) = active_provider.as_deref() {
        sqlx::query(
            "UPDATE ai_configurations SET is_default = 1
              WHERE id = (
                  SELECT id FROM ai_configurations
                   WHERE provider = ? ORDER BY created_at ASC LIMIT 1
              )",
        )
        .bind(active)
        .execute(pool)
        .await?;
    }
    let any_default: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM ai_configurations WHERE is_default = 1",
    )
    .fetch_one(pool)
    .await?;
    if any_default.0 == 0 {
        if let Some(id) = first_id {
            sqlx::query("UPDATE ai_configurations SET is_default = 1 WHERE id = ?")
                .bind(id)
                .execute(pool)
                .await?;
        }
    }

    // Flag idempotency.
    sqlx::query(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai:legacy_imported', '1')",
    )
    .execute(pool)
    .await?;

    Ok(())
}

fn cap_ai_provider(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}
