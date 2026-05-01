// Cross-platform infrastructure shared across modes.
// `credential_store` is the OS-keyring abstraction.
// `shell` resolves the user's preferred shell binary per OS.

pub mod credential_store;
pub mod shell;
