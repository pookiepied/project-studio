//! What the kernel actually allows, asked from *inside* the container.
//!
//! This exists because the first measurement of the enumeration problem was
//! taken through `cmd /c dir`, and `dir` answers a different question than the
//! one being asked: it reports failure for reasons of its own — an inherited
//! working directory it cannot open, for one — and reports it as the same
//! "Access is denied." the kernel would give. A diagnosis built on that is a
//! diagnosis of `cmd.exe`.
//!
//! So the probe opens the handle itself and prints the raw error number. It is
//! kept rather than deleted with the spike: `available()` on the Windows
//! backend needs a cheap, truthful answer to "can this machine actually contain
//! anything", and asking is better than assuming.

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CREATE_ALWAYS, CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_LIST_DIRECTORY,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FindClose,
    FindFirstFileW, OPEN_EXISTING, WIN32_FIND_DATAW,
};

use crate::wide::to_wide;

/// Reports each right separately, one line each, `name: ok` or `name: error N`.
///
/// One line per question on purpose. A single pass/fail would have hidden the
/// finding that mattered — that opening a file and listing its directory are
/// different rights with different answers.
pub fn run(path: &str) -> Result<i32, String> {
    let mut denied = false;

    denied |= report("open-directory", open_directory(path));
    denied |= report("enumerate", enumerate(path));
    denied |= report("open-file", open_file(path));
    denied |= report("create-file", create_file(path));

    // Non-zero when anything was refused, so a caller can branch on the exit
    // code without parsing the lines.
    Ok(if denied { 1 } else { 0 })
}

fn report(label: &str, outcome: Result<String, u32>) -> bool {
    match outcome {
        Ok(detail) => {
            println!("{label}: ok {detail}");
            false
        }
        Err(code) => {
            println!("{label}: error {code}");
            true
        }
    }
}

fn open_directory(path: &str) -> Result<String, u32> {
    let wide = to_wide(path);
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            // Without this a directory cannot be opened at all, whatever the
            // rights say.
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(unsafe { GetLastError() });
    }
    unsafe { CloseHandle(handle) };
    Ok(String::new())
}

fn enumerate(path: &str) -> Result<String, u32> {
    let wide = to_wide(&format!("{path}\\*"));
    let mut found: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    let handle = unsafe { FindFirstFileW(wide.as_ptr(), &mut found) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(unsafe { GetLastError() });
    }
    unsafe { FindClose(handle) };
    Ok(String::new())
}

/// Whether the container may *create* something here.
///
/// Asked separately from reading because a read grant that quietly also allows
/// writing is the failure this whole feature exists to prevent, and nothing
/// else in the probe would notice it.
fn create_file(path: &str) -> Result<String, u32> {
    let target = format!("{path}\\studio-probe-write.tmp");
    let wide = to_wide(&target);
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            CREATE_ALWAYS,
            0,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(unsafe { GetLastError() });
    }
    unsafe { CloseHandle(handle) };
    // Left on disk deliberately: the caller checks for it, so a probe that
    // reported success while writing nothing would be caught.
    Ok(target)
}

fn open_file(path: &str) -> Result<String, u32> {
    let wide = to_wide(path);
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(unsafe { GetLastError() });
    }
    unsafe { CloseHandle(handle) };
    Ok(String::new())
}
