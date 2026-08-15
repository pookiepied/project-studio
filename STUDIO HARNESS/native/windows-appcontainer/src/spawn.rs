//! Starting a child under an AppContainer token.
//!
//! The containment is applied by the kernel at `CreateProcessW` time and cannot
//! be dropped by the child afterwards. That is the property that makes this
//! worth building at all: unlike a check in our own code, there is nothing for
//! a misbehaving program to route around.

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_FAILED};
use windows_sys::Win32::Security::{SECURITY_CAPABILITIES, PSID};
use windows_sys::Win32::System::Threading::{
    CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT,
    GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::UI::Shell::{FOLDERID_LocalAppData, SHGetKnownFolderPath};
use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};

use crate::sid::OwnedSid;
use crate::wide::{from_wide_ptr, to_wide};

/// Quotes one argument the way `CommandLineToArgvW` will read it back.
///
/// Windows has no argument vector at the API boundary — `CreateProcessW` takes
/// a single string and the child splits it again. This function is the join
/// half of that round trip, and it is the reason the harness can keep promising
/// that an argument is never reinterpreted: a path with a space or a quote in
/// it arrives as one argument, not as several.
fn quote(argument: &str) -> String {
    if !argument.is_empty() && !argument.contains([' ', '\t', '"']) {
        return argument.to_string();
    }

    let mut quoted = String::with_capacity(argument.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for character in argument.chars() {
        match character {
            '\\' => {
                backslashes += 1;
                quoted.push('\\');
            }
            '"' => {
                // Every backslash immediately before a quote is doubled, and the
                // quote itself is escaped. Getting this wrong is how `C:\dir\`
                // becomes an unterminated string.
                for _ in 0..=backslashes {
                    quoted.push('\\');
                }
                backslashes = 0;
                quoted.push('"');
            }
            _ => {
                backslashes = 0;
                quoted.push(character);
            }
        }
    }
    for _ in 0..backslashes {
        quoted.push('\\');
    }
    quoted.push('"');
    quoted
}

/// The full command line for an executable and its arguments.
///
/// Public so the harness's tests can assert the join without spawning anything.
pub fn command_line(executable: &str, arguments: &[String]) -> String {
    let mut line = quote(executable);
    for argument in arguments {
        line.push(' ');
        line.push_str(&quote(argument));
    }
    line
}

/// The environment the contained child receives.
///
/// Everything the launcher itself was given, plus `LOCALAPPDATA` when it is
/// absent — and that one addition is not a convenience.
///
/// `CreateProcessW` fails with error 203, `ERROR_ENVVAR_NOT_FOUND`, when an
/// AppContainer is requested and `LOCALAPPDATA` is not in the environment:
/// every container has a per-package data directory beneath it, and Windows
/// resolves that path from the variable rather than from the token. The harness
/// deliberately hands children a near-empty environment — that is ADR 0039's
/// whole point, and it is what keeps every API key on the machine away from
/// them — so the variable is genuinely missing, and the failure looked like a
/// broken sandbox rather than a missing string.
///
/// Filled in here rather than by widening the harness's allowlist, because it
/// is a requirement of *this containment mechanism* and not of children in
/// general. Adding it upstream would hand it to every first-party tool too, for
/// a reason none of them have. The value is read from the OS with
/// `SHGetKnownFolderPath`, so it is correct even though the launcher's own
/// environment does not have it either.
fn environment_block() -> Result<Vec<u16>, String> {
    let mut variables: Vec<(String, String)> = std::env::vars().collect();

    if !variables.iter().any(|(name, _)| name.eq_ignore_ascii_case("LOCALAPPDATA")) {
        variables.push(("LOCALAPPDATA".to_string(), local_app_data()?));
    }

    let mut block: Vec<u16> = Vec::new();
    for (name, value) in variables {
        // A variable whose name starts with `=` is a Windows drive-current
        // directory marker. They are legal in a block and would corrupt it if
        // re-encoded as a normal pair.
        if name.starts_with('=') {
            continue;
        }
        block.extend(to_wide(&format!("{name}={value}")));
    }
    // A block is a run of NUL-terminated strings and one more NUL to end it.
    block.push(0);
    Ok(block)
}

fn local_app_data() -> Result<String, String> {
    let mut buffer: *mut u16 = std::ptr::null_mut();
    let hr = unsafe {
        SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, std::ptr::null_mut(), &mut buffer)
    };
    if hr < 0 {
        return Err(format!("could not locate the local application data folder (hr=0x{hr:08x})"));
    }
    let path = unsafe { from_wide_ptr(buffer) };
    unsafe { CoTaskMemFree(buffer as _) };
    Ok(path)
}

/// An attribute list, sized by the OS and freed on drop.
struct AttributeList {
    buffer: Vec<u8>,
}

impl AttributeList {
    fn with_security_capabilities(
        capabilities: &SECURITY_CAPABILITIES,
    ) -> Result<Self, String> {
        let mut size = 0usize;
        // The first call always "fails"; its purpose is to report the size.
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size) };
        if size == 0 {
            return Err("could not size the process attribute list".to_string());
        }

        let mut list = Self { buffer: vec![0u8; size] };
        let pointer = list.pointer();

        let ok = unsafe { InitializeProcThreadAttributeList(pointer, 1, 0, &mut size) };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            // Leaked deliberately rather than deleted: an uninitialised list
            // must not be passed to `DeleteProcThreadAttributeList`.
            std::mem::forget(list);
            return Err(format!("could not prepare the sandbox attributes (error {code})"));
        }

        let ok = unsafe {
            UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                capabilities as *const SECURITY_CAPABILITIES as *const _,
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            return Err(format!("could not apply the sandbox token (error {code})"));
        }

        Ok(list)
    }

    fn pointer(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.pointer()) };
    }
}

pub struct Request<'a> {
    pub sid: &'a OwnedSid,
    pub executable: &'a str,
    pub arguments: &'a [String],
    pub working_directory: Option<&'a str>,
}

/// Runs the child to completion and returns its exit code.
///
/// Blocking on purpose. This binary is a launcher, not a supervisor: the
/// harness already owns timeouts, output limits and tree kills in
/// `process/exec.ts`, and a second implementation of those here would be a
/// second set of rules to keep in agreement.
pub fn run(request: Request<'_>) -> Result<u32, String> {
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: request.sid.raw() as PSID,
        Capabilities: std::ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };

    let mut attributes = AttributeList::with_security_capabilities(&capabilities)?;

    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    startup.StartupInfo.hStdOutput = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    startup.StartupInfo.hStdError = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    startup.lpAttributeList = attributes.pointer();

    let mut line = to_wide(&command_line(request.executable, request.arguments));
    let executable = to_wide(request.executable);
    let directory = request.working_directory.map(to_wide);

    let environment = environment_block()?;
    let mut information: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            // Only the three standard handles are inheritable in practice; the
            // child needs them to say anything at all.
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
            // What the harness built, per ADR 0039, with the one addition
            // AppContainer itself requires. See `environment_block`.
            environment.as_ptr() as *const _,
            directory.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()),
            &startup as *const STARTUPINFOEXW as *const _,
            &mut information,
        )
    };

    if ok == 0 {
        let code = unsafe { GetLastError() };
        // Error 5 here means the child could not even be *read* by the
        // container — the executable itself needs a traverse-and-read grant,
        // which is easy to forget when only the workspace is on the list.
        return Err(format!(
            "could not start {} inside the sandbox (error {code})",
            request.executable
        ));
    }

    let status = unsafe { WaitForSingleObject(information.hProcess, INFINITE) };
    if status == WAIT_FAILED {
        let code = unsafe { GetLastError() };
        return Err(format!("lost track of the sandboxed program (error {code})"));
    }

    let mut exit_code: u32 = 0;
    let ok = unsafe { GetExitCodeProcess(information.hProcess, &mut exit_code) };
    close(information.hThread);
    close(information.hProcess);
    if ok == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("could not read the program's result (error {code})"));
    }
    Ok(exit_code)
}

fn close(handle: HANDLE) {
    if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
        unsafe { CloseHandle(handle) };
    }
}
