/// Returns the user's preferred interactive shell binary for the current OS.
///
/// On Unix: `$SHELL`, falling back to `/bin/zsh`.
/// On Windows: `%COMSPEC%`, falling back to `powershell.exe`.
///
/// Note: This returns only the binary path. Spawn-args (`-l -i -c …` for bash/zsh
/// vs `-NoLogo` / `-Command` for PowerShell) differ per shell and must be handled
/// at the call site. Today the agent module hard-codes bash-style args, which
/// works on macOS/Linux but is wrong for PowerShell on Windows. Reworking the
/// spawn-args is tracked as part of the Windows runtime-parity work.
pub fn default_user_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}
