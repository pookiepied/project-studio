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

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::wide::to_wide;

/// Whether a name resolves from inside the container.
///
/// Separate from connecting because they fail separately and for different
/// reasons: DNS goes through a system service the container may not be allowed
/// to talk to, while a connection to a literal address does not involve it at
/// all. Reporting one number for both would hide which wall was hit.
pub fn resolve(host: &str) -> i32 {
    match (host, 0u16).to_socket_addrs() {
        Ok(mut addresses) => match addresses.next() {
            Some(address) => {
                println!("resolve {host}: ok {}", address.ip());
                0
            }
            None => {
                println!("resolve {host}: error no-address");
                1
            }
        },
        Err(error) => {
            println!("resolve {host}: error {}", code(&error));
            1
        }
    }
}

/// Whether a TCP connection can be opened from inside the container.
///
/// The measurement the capability question turns on. `internetClient` is
/// documented to permit outbound connections to the internet and *not* to
/// loopback or the local network — so this is run against a public address, a
/// `127.0.0.1` listener and a LAN address, and the three answers are what
/// decide whether a network-using MCP server can be contained usefully.
pub fn connect(target: &str) -> i32 {
    let Ok(mut addresses) = target.to_socket_addrs() else {
        println!("connect {target}: error unresolved");
        return 1;
    };
    let Some(address) = addresses.next() else {
        println!("connect {target}: error no-address");
        return 1;
    };

    // A short timeout on purpose. A blocked connection on Windows is usually a
    // refusal, not a hang, and a probe that takes thirty seconds to say "no" is
    // a probe nobody runs twice.
    match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
        Ok(_) => {
            println!("connect {target}: ok");
            0
        }
        Err(error) => {
            println!("connect {target}: error {}", code(&error));
            1
        }
    }
}

fn code(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(number) => number.to_string(),
        None => error.kind().to_string(),
    }
}

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
