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

use crate::capability::Capabilities;
use crate::sid::OwnedSid;
use crate::wide::{from_wide_ptr, to_wide};

/// How the argument vector becomes the one string the child will parse.
///
/// Windows has no argv at the API boundary: `CreateProcessW` takes a single
/// string, and the child splits it again by its own rule. There is more than
/// one rule in use, and the difference is the whole reason this type exists.
/// A command interpreter reads a *command line*; a program reads *arguments*;
/// escaping arguments for one and handing them to the other is how a
/// fully-qualified path arrives as `'\"C:\Program Files\...\"' is not
/// recognized`, which is what the first contained command on Windows produced.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Join {
    /// Each argument quoted and escaped the way `CommandLineToArgvW` reads it
    /// back. Right for any child whose runtime builds an argv from the line -
    /// a program we chose (`git`, `rg`), and every interpreter whose host
    /// parses its own line with the standard rules before deciding what the
    /// arguments mean (bash, and the two PowerShell hosts, whose `-Command`
    /// therefore arrives as one intact argument).
    Argv,
    /// Arguments joined with single spaces, verbatim, with only this much
    /// structure: an argument holding whitespace (or an empty one) is wrapped
    /// in one pair of quotes, and nothing inside is escaped. Right for a child
    /// that reads the raw remainder of its own command line and parses it as
    /// shell syntax — `cmd.exe` after `/c`, whose `/s` strip rule then removes
    /// exactly the one pair of quotes this join adds.
    ///
    /// It is deliberately *not* a mode that could serve every interpreter:
    /// `cmd.exe` must have the wrap, a PowerShell host must not have it (its
    /// parser would take the wrap as the whole command and lose the inner
    /// quotes), and the programs we chose need full escaping. Which child
    /// wants which is declared where the interpreter is described, in
    /// `src/process/interpreter.ts`, and handed over as `--join`.
    CommandLine,
}

/// Quotes one argument the way `CommandLineToArgvW` will read it back.
///
/// Windows has no argument vector at the API boundary - `CreateProcessW` takes
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

/// One argument in `Join::CommandLine` form.
///
/// Wrapping and nothing else. An inner quote is left exactly as it arrived,
/// because the child that reads this line is a shell whose parser owns the
/// quotes; escaping them would hand the shell backslash-quote pairs it reads
/// as data, which is the defect this mode exists to fix. An argument with no
/// whitespace needs no wrap, and a wrapper on it would hand `cmd.exe /s` a
/// first character that is a quote where none was intended.
fn command_argument(argument: &str) -> String {
    if argument.is_empty() {
        // An empty argument vanishes from a bare join; the empty string is the
        // form every parser agrees means "an argument that is there and empty".
        return "\"\"".to_string();
    }
    if argument.contains([' ', '\t']) {
        return format!("\"{argument}\"");
    }
    argument.to_string()
}

/// The full command line for an executable and its arguments.
///
/// Public so the harness's tests can assert the join without spawning anything.
pub fn command_line(executable: &str, arguments: &[String], join: Join) -> String {
    let mut line = quote(executable);
    for argument in arguments {
        line.push(' ');
        line.push_str(&match join {
            Join::Argv => quote(argument),
            Join::CommandLine => command_argument(argument),
        });
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
    /// Named holes in the wall, empty by default. See `capability.rs`.
    pub capabilities: &'a [String],
    pub executable: &'a str,
    pub arguments: &'a [String],
    /// How the arguments become the child's command line. See `Join`.
    pub join: Join,
    pub working_directory: Option<&'a str>,
}

/// Runs the child to completion and returns its exit code.
///
/// Blocking on purpose. This binary is a launcher, not a supervisor: the
/// harness already owns timeouts, output limits and tree kills in
/// `process/exec.ts`, and a second implementation of those here would be a
/// second set of rules to keep in agreement.
pub fn run(request: Request<'_>) -> Result<u32, String> {
    let mut granted = Capabilities::derive(request.capabilities)?;
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: request.sid.raw() as PSID,
        CapabilityCount: granted.count(),
        Capabilities: granted.pointer(),
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

    let mut line = to_wide(&command_line(request.executable, request.arguments, request.join));
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

#[cfg(test)]
mod tests {
    use super::{command_line, Join};

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    /// The defect this whole mode exists for, asserted on the join itself: an
    /// interpreter command line joined as argv data escapes its inner quotes,
    /// and `cmd.exe` reads the result as a program named `\"C:\Program`.
    #[test]
    fn argv_join_escapes_quotes_inside_an_interpreter_line() {
        let line = command_line(
            "C:\\Windows\\System32\\cmd.exe",
            &arguments(&[
                "/d",
                "/s",
                "/c",
                "\"C:\\Program Files\\nodejs\\node.exe\" -e \"console.log('hello')\"",
            ]),
            Join::Argv,
        );
        assert_eq!(
            line,
            "C:\\Windows\\System32\\cmd.exe /d /s /c \"\\\"C:\\Program Files\\nodejs\\node.exe\\\" -e \\\"console.log('hello')\\\"\""
        );
    }

    /// The same line, joined the way the reader of it wants it: verbatim, with
    /// one pair of quotes around the argument that carries whitespace, and
    /// nothing escaped. `cmd.exe /s` strips exactly that outer pair and runs
    /// the line the model wrote.
    #[test]
    fn command_line_join_keeps_the_interpreter_line_verbatim() {
        let line = command_line(
            "C:\\Windows\\System32\\cmd.exe",
            &arguments(&[
                "/d",
                "/s",
                "/c",
                "\"C:\\Program Files\\nodejs\\node.exe\" -e \"console.log('hello')\"",
            ]),
            Join::CommandLine,
        );
        assert_eq!(
            line,
            "C:\\Windows\\System32\\cmd.exe /d /s /c \
             \"\"C:\\Program Files\\nodejs\\node.exe\" -e \"console.log('hello')\"\""
                .replace("\\\\", "\\")
        );
    }

    /// An argument with no whitespace needs no wrap: `cmd.exe /s` only strips
    /// a leading quote, and adding one would make it strip a pair the model
    /// never wrote.
    #[test]
    fn command_line_join_wraps_only_whitespace() {
        let line = command_line(
            "C:\\Windows\\System32\\cmd.exe",
            &arguments(&["/d", "/s", "/c", "ver"]),
            Join::CommandLine,
        );
        assert_eq!(line, "C:\\Windows\\System32\\cmd.exe /d /s /c ver");
    }

    /// An argument-shaped child gets the same line from both joins, because a
    /// quoted `-c` body is one argument either way. The executable is always
    /// quoted - it is a path, and paths carry spaces.
    #[test]
    fn both_joins_agree_for_an_argument_shaped_child() {
        for join in [Join::Argv, Join::CommandLine] {
            let line = command_line(
                "C:\\Program Files\\Git\\bin\\bash.exe",
                &arguments(&["-c", "exit 0"]),
                join,
            );
            assert_eq!(
                line,
                "\"C:\\Program Files\\Git\\bin\\bash.exe\" -c \"exit 0\""
            );
        }
    }

    /// The programs the harness chose (`git`, `rg`) keep the escaping that
    /// makes an argument with a space or a quote arrive as one argument. This
    /// is the invariant the mode split must not break.
    #[test]
    fn argv_join_still_escapes_a_path_with_spaces() {
        let line = command_line(
            "C:\\Program Files\\Git\\cmd\\git.exe",
            &arguments(&["-C", "D:\\my project", "status"]),
            Join::Argv,
        );
        assert_eq!(
            line,
            "\"C:\\Program Files\\Git\\cmd\\git.exe\" -C \"D:\\my project\" status"
        );
    }

    /// An empty argument is wrapped in both modes, so it arrives as an
    /// argument rather than vanishing from the line.
    #[test]
    fn empty_arguments_survive_the_join() {
        for join in [Join::Argv, Join::CommandLine] {
            let line = command_line(
                "C:\\Program Files\\nodejs\\node.exe",
                &arguments(&["-e", ""]),
                join,
            );
            assert_eq!(line, "\"C:\\Program Files\\nodejs\\node.exe\" -e \"\"");
        }
    }
}
