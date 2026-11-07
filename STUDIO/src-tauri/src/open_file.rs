//! Opening a file a person clicked, in the app that is meant to show it.
//!
//! `reveal.rs` is navigation and can never start anything. This module is the
//! one step past it, and it stays narrow for the same reason: a path reaches
//! this window from a model's reply, so "open" must not become "run". Two doors,
//! each with its own limit, and the webview chooses neither the program nor the
//! arguments:
//!
//! - `open_file` hands a file to its Windows association, and only when its type
//!   is on a fixed list of inert kinds: documents, pictures, media. Everything
//!   else is refused, which is the point of a list over a block: on a stock
//!   Windows machine `.js` and `.vbs` run in Script Host, `.py` runs if Python is
//!   installed, and an unknown extension may be anything. Links are refused too,
//!   because a link named `report.md` can point at a program.
//! - `open_in_editor` hands any path to an editor found in a known install
//!   location. An editor shows a script; it does not run it. The program is
//!   started directly, never through `code.cmd`, because a batch file re-parses
//!   its arguments and a path is model-influenced text.
//!
//! Both run only from a person's click; the webview offers no other way in.

#[cfg(target_os = "windows")]
use crate::reveal::{classify, RevealKind};

const NOT_OPENABLE: &str = "Studio does not open this type of file directly. Use Show in folder instead.";
const NO_EDITOR: &str = "That editor is not installed on this computer.";
const OPEN_FAILED: &str = "Windows could not open this file.";
const EDITOR_FAILED: &str = "The editor could not be started.";
#[cfg(not(target_os = "windows"))]
const NOT_WINDOWS: &str = "Opening files is only available on Windows.";

/// Kinds whose Windows association shows them rather than runs them.
const INERT_EXTENSIONS: &[&str] = &[
    // Text and data.
    "md", "markdown", "txt", "log", "csv", "tsv", "json", "yaml", "yml", "rtf",
    // Pages. A browser sandboxes these, which is what makes them inert here.
    "html", "htm",
    // Pictures.
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "heic", "tif", "tiff",
    // Video and sound.
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "mp3", "wav", "flac", "ogg", "m4a", "aac", "opus",
    // Documents. The macro-enabled Office types are left out on purpose.
    "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp",
];

/// Whether this name's type may go to its Windows association.
///
/// Read from the last segment, so a separator cannot supply an extension. A name
/// ending in a dot or a space has none, and Windows would trim that ending off.
fn is_inert(path: &str) -> bool {
    let name = path.rsplit(['\\', '/']).next().unwrap_or("");
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    !stem.is_empty() && INERT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

/// One editor Studio knows how to start, and where it installs itself.
struct Editor {
    id: &'static str,
    label: &'static str,
    /// An environment variable naming a base folder, and the program beneath it.
    installs: &'static [(&'static str, &'static str)],
}

const EDITORS: &[Editor] = &[
    Editor {
        id: "vscode",
        label: "VS Code",
        installs: &[
            ("LOCALAPPDATA", r"Programs\Microsoft VS Code\Code.exe"),
            ("ProgramFiles", r"Microsoft VS Code\Code.exe"),
        ],
    },
    Editor {
        id: "cursor",
        label: "Cursor",
        installs: &[("LOCALAPPDATA", r"Programs\cursor\Cursor.exe")],
    },
];

fn installed(editor: &Editor) -> Option<std::path::PathBuf> {
    editor.installs.iter().find_map(|(base, program)| {
        let path = std::path::PathBuf::from(std::env::var_os(base)?).join(program);
        path.is_file().then_some(path)
    })
}

/// An editor found on this computer, for the webview to offer by name.
#[derive(serde::Serialize)]
pub struct EditorChoice {
    id: &'static str,
    label: &'static str,
}

#[tauri::command]
pub fn list_editors() -> Vec<EditorChoice> {
    EDITORS
        .iter()
        .filter(|editor| installed(editor).is_some())
        .map(|editor| EditorChoice { id: editor.id, label: editor.label })
        .collect()
}

/// What the editor is told. A line goes through `--goto`, which reads the suffix
/// off the path; with no line the path stands alone so `:` is never reinterpreted.
fn editor_arguments(path: &str, line: Option<u32>, column: Option<u32>) -> Vec<String> {
    match (line, column) {
        (Some(line), Some(column)) => vec!["--goto".into(), format!("{path}:{line}:{column}")],
        (Some(line), None) => vec!["--goto".into(), format!("{path}:{line}")],
        _ => vec![path.to_string()],
    }
}

#[tauri::command]
pub async fn open_in_editor(editor: String, path: String, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start_editor(&editor, &path, line, column).map_err(str::to_string))
        .await
        .map_err(|_| EDITOR_FAILED.to_string())?
}

fn start_editor(id: &str, path: &str, line: Option<u32>, column: Option<u32>) -> Result<(), &'static str> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (id, path, line, column, NO_EDITOR);
        return Err(NOT_WINDOWS);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        classify(path)?;
        let program = EDITORS.iter().find(|editor| editor.id == id).and_then(installed).ok_or(NO_EDITOR)?;
        Command::new(program)
            .args(editor_arguments(&path.replace('/', r"\"), line, column))
            // Set by a parent Electron tool, this would start the editor as bare Node.
            .env_remove("ELECTRON_RUN_AS_NODE")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(drop)
            .map_err(|_| EDITOR_FAILED)
    }
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open(&path).map_err(str::to_string))
        .await
        .map_err(|_| OPEN_FAILED.to_string())?
}

fn open(path: &str) -> Result<(), &'static str> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, NOT_OPENABLE, OPEN_FAILED, is_inert as fn(&str) -> bool);
        return Err(NOT_WINDOWS);
    }
    #[cfg(target_os = "windows")]
    {
        if classify(path)? != RevealKind::Item || !is_inert(path) {
            return Err(NOT_OPENABLE);
        }
        let normalized = path.replace('/', r"\");
        let is_link = std::fs::symlink_metadata(&normalized).map_or(true, |meta| meta.file_type().is_symlink());
        if is_link {
            return Err(NOT_OPENABLE);
        }
        shell_open(&normalized)
    }
}

#[cfg(target_os = "windows")]
fn shell_open(path: &str) -> Result<(), &'static str> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // A handler may be a COM server, so the Shell wants this thread initialized.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
        return Err(OPEN_FAILED);
    }
    let result = unsafe {
        ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(path), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    if initialized.is_ok() {
        unsafe { CoUninitialize() };
    }
    // Documented: a value above 32 is success, anything else an error code.
    if result.0 as isize > 32 { Ok(()) } else { Err(OPEN_FAILED) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_and_media_may_use_their_association() {
        for path in [r"C:\a\report.md", r"C:\a\REPORT.PDF", r"C:\a\clip.mp4", "C:/a/chart.png", r"C:\a b\page.html"] {
            assert!(is_inert(path), "{path}");
        }
    }

    #[test]
    fn anything_that_could_run_is_refused() {
        for path in [
            r"C:\a\setup.exe", r"C:\a\go.bat", r"C:\a\go.cmd", r"C:\a\go.com", r"C:\a\run.ps1", r"C:\a\run.js",
            r"C:\a\run.vbs", r"C:\a\run.py", r"C:\a\run.hta", r"C:\a\run.msi", r"C:\a\run.scr", r"C:\a\link.lnk",
            r"C:\a\link.url", r"C:\a\pack.jar", r"C:\a\macro.docm", r"C:\a\macro.xlsm", r"C:\a\report.md.exe",
        ] {
            assert!(!is_inert(path), "{path}");
        }
    }

    #[test]
    fn a_name_that_only_looks_inert_is_refused() {
        // Windows trims a trailing dot or space, so these are not what they read as.
        for path in [r"C:\a\setup.exe.", r"C:\a\setup.md ", r"C:\a\.md", r"C:\a.md\setup", r"C:\a\noextension"] {
            assert!(!is_inert(path), "{path}");
        }
    }

    #[test]
    fn a_line_travels_through_goto_and_a_bare_path_does_not() {
        assert_eq!(editor_arguments(r"C:\a\b.ts", None, None), [r"C:\a\b.ts"]);
        assert_eq!(editor_arguments(r"C:\a\b.ts", Some(42), None), ["--goto", r"C:\a\b.ts:42"]);
        assert_eq!(editor_arguments(r"C:\a\b.ts", Some(42), Some(7)), ["--goto", r"C:\a\b.ts:42:7"]);
        // A column means nothing without its line.
        assert_eq!(editor_arguments(r"C:\a\b.ts", None, Some(7)), [r"C:\a\b.ts"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn an_unknown_editor_name_starts_nothing() {
        assert_eq!(start_editor("cmd", r"C:\Windows", None, None), Err(NO_EDITOR));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn a_refused_type_is_refused_before_the_shell_is_reached() {
        let folder = std::env::temp_dir().join(format!("studio-open-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("fixture folder");
        let program = folder.join("fixture.bat");
        std::fs::write(&program, "exit /b 0").expect("fixture file");
        assert_eq!(open(program.to_str().expect("utf-8")), Err(NOT_OPENABLE));
        assert_eq!(open(folder.to_str().expect("utf-8")), Err(NOT_OPENABLE));
        std::fs::remove_dir_all(&folder).ok();
    }
}
