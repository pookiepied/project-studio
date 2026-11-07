//! Showing a filesystem location in Windows File Explorer, and nothing else.
//!
//! The contract this module exists to keep: reveal is *navigation*. A file -
//! an executable, a script, a shortcut, an archive - is opened *in* its
//! folder and selected there; a folder is opened; and whatever was named is
//! never run, resolved through a shell, or launched by any other means. The
//! webview only ever sends a path, never a verb, and the native side decides
//! the verb: there is no input this command accepts that can turn "show me
//! this place" into "run this thing".
//!
//! That rules out the obvious mechanisms on purpose. No `ShellExecute` open
//! verb (it launches what it is handed), no `cmd`/PowerShell/`start` (a
//! composed shell command is an injection with extra steps), no following a
//! `.lnk` to its target (a shortcut is an item to reveal, not a programme to
//! start). What is used instead is the Shell API built for exactly this:
//! `SHOpenFolderAndSelectItems`, which opens a folder view and selects items
//! inside it, and which treats every path - including a shortcut's or a
//! symlink's own path - as an item to select, never as a programme.
//!
//! Existence is decided from filesystem metadata, not from the path's
//! spelling: a `.exe` and a `.txt` take the same road, because the danger
//! was never the file type, it was the launch.

/// The one sentence the person reads when a reveal cannot happen. Every
/// string here is fixed: nothing from the path, the error, or the OS enters
/// a message that reaches the webview.
const NOT_A_PATH: &str = "That reference is not a path this computer can open.";
const NOT_FOUND: &str = "Path not found.";
const INACCESSIBLE: &str = "That path cannot be accessed.";
const NETWORK: &str = "Network locations cannot be shown from here.";
#[cfg(not(target_os = "windows"))]
const NOT_WINDOWS: &str = "Showing a file in File Explorer is only available on Windows.";
const SHELL_FAILED: &str = "File Explorer could not be opened.";

/// The largest path this command will consider. Far past any real Windows
/// path, small enough that a runaway model string costs nothing to refuse.
const MAX_LEN: usize = 4096;

/// Whether the command is willing to consider `path` at all, before any
/// filesystem or shell work. Only a plain, absolute, drive-letter Windows
/// path passes: relative paths are resolved by the webview against the
/// conversation's workspace, never here - letting `C:` mean "the current
/// directory" would be a guess about where a reveal lands. Device
/// namespaces are not folders a person browses, and a UNC path is another
/// computer's filesystem, which this command names honestly rather than
/// probing (a `stat` on a dead share hangs; navigation must not).
fn validate(path: &str) -> Result<(), &'static str> {
    if path.starts_with(r"\\.\") || path.starts_with(r"\\?\") {
        return Err(NOT_A_PATH);
    }
    if path.starts_with(r"\\") || path.starts_with(r"//") {
        return Err(NETWORK);
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    if !drive
        || path.len() > MAX_LEN
        || path.chars().any(|c| c.is_control() || matches!(c, '"' | '|' | '<' | '>' | '*' | '?'))
        || path.get(2..).is_some_and(|tail| tail.contains(':'))
    {
        return Err(NOT_A_PATH);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RevealKind {
    Folder,
    Item,
}

/// Links remain items to select, including broken links and directory junctions.
pub(crate) fn classify(path: &str) -> Result<RevealKind, &'static str> {
    validate(path)?;
    let normalized = path.replace('/', r"\");
    classify_metadata(std::fs::symlink_metadata(&normalized))
}

/// The metadata read's verdict. A miss is the missing one; any other
/// refusal - permissions, a sharing violation, a locked volume - is reported
/// as inaccessible rather than rounded down to "not found", because the two
/// sentences ask for different repairs.
fn classify_metadata(result: std::io::Result<std::fs::Metadata>) -> Result<RevealKind, &'static str> {
    match result {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(RevealKind::Folder),
        Ok(_) => Ok(RevealKind::Item),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(NOT_FOUND),
        Err(_) => Err(INACCESSIBLE),
    }
}

/// The command the webview calls: one absolute path in, File Explorer
/// showing that place out. Waiting off the main thread keeps a slow
/// metadata read from holding the UI, exactly as the browser opener does.
#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal(&path).map_err(|error| error.to_string()))
        .await
        .map_err(|_| SHELL_FAILED.to_string())?
}

fn reveal(path: &str) -> Result<(), &'static str> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        return Err(NOT_WINDOWS);
    }
    #[cfg(target_os = "windows")]
    {
        let kind = classify(path)?;
        explorer_reveal(&path.replace('/', r"\"), kind)
    }
}

/// The reveal itself. The item ID list is built from the path as given -
/// the shell reads it as an item, and whether that item is a programme, a
/// document, a shortcut or a folder changes only what Explorer selects,
/// never what it starts.
#[cfg(target_os = "windows")]
fn explorer_reveal(path: &str, kind: RevealKind) -> Result<(), &'static str> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

    // The Shell is COM's customer, not this thread's: initialize what this
    // call needs and undo exactly that. A thread already initialized in
    // another mode is fine to run on, and must not be uninitialized here.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
        return Err(SHELL_FAILED);
    }
    let result = unsafe {
        let wide = HSTRING::from(path);
        let pidl = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
        if pidl.is_null() {
            // The shell refused to build an item for the path; the metadata
            // read above already passed, so the honest answer is still the
            // missing one rather than a half-reveal.
            Err(NOT_FOUND)
        } else {
            // A zero-length selection opens the parent. An empty child PIDL
            // instead names the directory itself, without selecting a child.
            let empty = windows::Win32::UI::Shell::Common::ITEMIDLIST::default();
            let children = selected_children(kind, &empty);
            let opened = SHOpenFolderAndSelectItems(pidl, children.as_ref().map(|items| items.as_slice()), 0);
            ILFree(Some(pidl));
            if opened.is_ok() { Ok(()) } else { Err(SHELL_FAILED) }
        }
    };
    if initialized.is_ok() {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(target_os = "windows")]
fn selected_children(
    kind: RevealKind,
    empty: &windows::Win32::UI::Shell::Common::ITEMIDLIST,
) -> Option<[*const windows::Win32::UI::Shell::Common::ITEMIDLIST; 1]> {
    match kind {
        RevealKind::Folder => Some([empty]),
        RevealKind::Item => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_absolute_drive_paths_are_considered() {
        for path in [
            "", "src/app.ts", "app.ts", "C:relative", "C:", "shell:Desktop",
            "shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}", r"\\.\pipe\name", r"\\?\C:\Windows",
            "/home/user/file.txt", "file:///C:/Windows",
            "C:\\a.exe & C:\\b.exe", "%APPDATA%\\x", "~\\report.md",
            r"C:\reports\*.pdf",
        ] {
            assert_eq!(validate(path), Err(NOT_A_PATH), "should refuse {path:?}");
        }
        for path in [r"\\server\share\file.txt", "//server/share/file.txt"] {
            assert_eq!(validate(path), Err(NETWORK), "should refuse {path:?} as a network place");
        }
        for path in [r"C:\Windows", "C:/mixed/slashes.txt", r"D:\data\report.pdf"] {
            assert_eq!(validate(path), Ok(()), "should accept {path:?}");
        }
        for path in [r"C:\Program Files", r"C:\O'Brien\R&D; 50%.txt", r"C:\"] {
            assert_eq!(validate(path), Ok(()), "ordinary filename {path:?}");
        }
    }

    #[test]
    fn metadata_errors_keep_missing_and_inaccessible_distinct() {
        use std::io::{Error, ErrorKind};
        assert_eq!(classify_metadata(Err(Error::from(ErrorKind::NotFound))), Err(NOT_FOUND));
        assert_eq!(classify_metadata(Err(Error::from(ErrorKind::PermissionDenied))), Err(INACCESSIBLE));
        assert_eq!(classify_metadata(Err(Error::from(ErrorKind::Other))), Err(INACCESSIBLE));
    }

    #[test]
    fn overlong_and_control_paths_are_refused_without_touching_the_filesystem() {
        assert_eq!(validate(&"C:\\a".repeat(2000)), Err(NOT_A_PATH));
        assert_eq!(validate("C:\\a\u{0000}b"), Err(NOT_A_PATH));
        assert_eq!(validate("C:\\a\nb"), Err(NOT_A_PATH));
    }

    #[cfg(target_os = "windows")]
    fn fixture_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("studio-reveal-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("fixture directory");
        root
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn metadata_decides_whether_a_path_exists_and_missing_paths_report_missing() {
        let root = fixture_root();
        let document = root.join("report.pdf");
        std::fs::write(&document, b"not really a pdf").expect("fixture file");
        assert_eq!(classify(&document.to_string_lossy()), Ok(RevealKind::Item));
        assert_eq!(classify(&root.to_string_lossy()), Ok(RevealKind::Folder));
        assert_eq!(classify(&root.join("missing.txt").to_string_lossy()), Err(NOT_FOUND));

        // Every kind of file the brief names, including the ones that would
        // be dangerous to *open*, classifies as the same thing: a file to
        // select. The launch is impossible by construction - nothing in this
        // module can execute anything - and the classification is where a
        // type-based fork would have grown one.
        for name in ["Studio.exe", "run.bat", "run.cmd", "run.ps1", "shortcut.lnk", "bundle.zip", "setup.msi"] {
            let path = root.join(name);
            std::fs::write(&path, b"fixture bytes").expect("fixture file");
            assert_eq!(classify(&path.to_string_lossy()), Ok(RevealKind::Item), "{name} is a file to select, never to run");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn reveal_refuses_what_classification_refuses_before_any_shell_work() {
        // The shell call itself needs a desktop to verify; what can be
        // verified here is that no path rejected by classification ever
        // reaches it - and that a command tail, which the webview never
        // sends, is still only ever treated as a path: this one does not
        // exist, and the answer is the missing one, not an execution.
        assert_eq!(reveal("relative/path.txt"), Err(NOT_A_PATH));
        assert_eq!(reveal(r"\\server\share\file.txt"), Err(NETWORK));
        assert_eq!(reveal(r"C:\bad:name.txt"), Err(NOT_A_PATH));
        assert_eq!(reveal(r"C:\Windows\system32\cmd.exe /c whoami"), Err(NOT_FOUND));
        assert_eq!(reveal(r"C:\Apps\Studio\Studio.exe --flag"), Err(NOT_FOUND));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn directories_open_themselves_and_files_select_in_the_parent() {
        use windows::Win32::UI::Shell::Common::ITEMIDLIST;
        let empty = ITEMIDLIST::default();
        let child: *const ITEMIDLIST = &empty;
        assert_eq!(selected_children(RevealKind::Folder, &empty), Some([child]));
        assert_eq!(selected_children(RevealKind::Item, &empty), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Opens File Explorer for hands-on navigation verification"]
    fn live_explorer_folder() {
        let root = fixture_root().join("folder self");
        std::fs::create_dir_all(&root).expect("fixture folder");
        assert_eq!(reveal(&root.to_string_lossy()), Ok(()));
        println!("Explorer must show the contents of: {}", root.display());
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Opens File Explorer for hands-on selection verification"]
    fn live_explorer_file() {
        let root = fixture_root().join("file parent");
        std::fs::create_dir_all(&root).expect("fixture folder");
        let file = root.join("O'Brien & report; 50%.exe");
        std::fs::write(&file, b"This is a reveal fixture, not an executable.").expect("fixture file");
        assert_eq!(reveal(&file.to_string_lossy()), Ok(()));
        println!("Explorer must select, never launch: {}", file.display());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_platforms_refuse_honestly() {
        assert_eq!(reveal("C:\\Windows"), Err(NOT_WINDOWS));
    }
}
