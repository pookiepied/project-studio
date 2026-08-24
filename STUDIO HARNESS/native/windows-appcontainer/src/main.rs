//! `studio-contain` — run a program inside a Windows AppContainer.
//!
//! # Why a separate binary
//!
//! Containment on Windows is three Win32 calls Node cannot make. The
//! alternatives were a native addon, which makes every platform's test run
//! depend on a compiled module, or moving tool execution into the Tauri host,
//! which is a rewrite. A launcher is the smallest thing that works, and it is
//! the shape Linux already has — `bwrap` is this binary, supplied by the OS.
//!
//! # The contract
//!
//! ```text
//! studio-contain profile-ensure --name <name> [--display <text>]   → SID on stdout
//! studio-contain profile-delete --name <name>
//! studio-contain grant  --sid <sid> --path <path> --mode traverse|read|write
//! studio-contain revoke --sid <sid> --path <path> [--mode traverse|read|write]
//! studio-contain check  --sid <sid> --path <path> --mode traverse|read|write
//! studio-contain run    --sid <sid> [--cwd <dir>] [--capability <name>]... — <program> [args...]
//! ```
//!
//! `run` exits with the child's own exit code, so a contained `git` reports
//! failure exactly as an uncontained one does. That leaves no code free to mean
//! "the launcher itself failed", which is why {@link LAUNCHER_FAILURE} exists:
//! a reserved value, documented on both sides, rather than a guess at the call
//! site.

mod acl;
mod capability;
mod probe;
mod profile;
mod sid;
mod spawn;
mod wide;

use crate::sid::OwnedSid;

/// The exit code this binary uses for its own failures.
///
/// 125 by the same convention `env` and `timeout` follow. A child that happens
/// to exit 125 is indistinguishable from a launcher failure, and that ambiguity
/// is accepted knowingly: the alternative is a side channel, and every side
/// channel is a thing that can be missing.
const LAUNCHER_FAILURE: i32 = 125;

const USAGE: &str = "\
studio-contain — run a program inside a Windows AppContainer

  profile-ensure --name <name> [--display <text>]
  profile-delete --name <name>
  grant  --sid <sid> --path <path> --mode traverse|read|write
  revoke --sid <sid> --path <path> [--mode traverse|read|write]
  check  --sid <sid> --path <path> --mode traverse|read|write
  run    --sid <sid> [--cwd <dir>] [--capability <name>]... -- <program> [args...]
  probe  --path <path> | --connect <host:port> | --resolve <host>
";

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&arguments) {
        Ok(code) => std::process::exit(code),
        Err(message) => {
            eprintln!("studio-contain: {message}");
            std::process::exit(LAUNCHER_FAILURE);
        }
    }
}

fn dispatch(arguments: &[String]) -> Result<i32, String> {
    let Some(command) = arguments.first() else {
        return Err(format!("no command given\n\n{USAGE}"));
    };

    match command.as_str() {
        "profile-ensure" => {
            let options = Options::parse(&arguments[1..])?;
            let name = options.required("--name")?;
            let display = options.get("--display").unwrap_or(name);
            let sid = profile::ensure(name, display)?;
            // stdout carries exactly one thing, so the caller parses a line
            // rather than a format.
            println!("{}", sid.to_text()?);
            Ok(0)
        }
        "profile-delete" => {
            let options = Options::parse(&arguments[1..])?;
            profile::delete(options.required("--name")?)?;
            Ok(0)
        }
        "grant" => {
            let options = Options::parse(&arguments[1..])?;
            let sid = OwnedSid::parse(options.required("--sid")?)?;
            let mode = acl::Mode::parse(options.required("--mode")?)?;
            acl::grant(options.required("--path")?, &sid, mode)?;
            Ok(0)
        }
        "revoke" => {
            let options = Options::parse(&arguments[1..])?;
            let sid = OwnedSid::parse(options.required("--sid")?)?;
            // Defaults to the propagating form, which is what a workspace
            // grant needs undone. A traverse entry says so.
            let mode = match options.get("--mode") {
                Some(text) => acl::Mode::parse(text)?,
                None => acl::Mode::Read,
            };
            acl::revoke(options.required("--path")?, &sid, mode)?;
            Ok(0)
        }
        "run" => {
            let options = Options::parse(&arguments[1..])?;
            let sid = OwnedSid::parse(options.required("--sid")?)?;
            let command = options.trailing();
            let Some((executable, rest)) = command.split_first() else {
                return Err("no program to run was given after `--`".to_string());
            };
            let capabilities = options.all("--capability");
            let code = spawn::run(spawn::Request {
                sid: &sid,
                capabilities: &capabilities,
                executable,
                arguments: rest,
                working_directory: options.get("--cwd"),
            })?;
            Ok(code as i32)
        }
        "check" => {
            let options = Options::parse(&arguments[1..])?;
            let sid = OwnedSid::parse(options.required("--sid")?)?;
            let mode = acl::Mode::parse(options.required("--mode")?)?;
            let held = acl::holds(options.required("--path")?, &sid, mode)?;
            println!("{}", if held { "granted" } else { "missing" });
            // Exit code as well as a word, so a caller can branch without
            // parsing. "Missing" is an answer, not a failure.
            Ok(if held { 0 } else { 1 })
        }
        "probe" => {
            let options = Options::parse(&arguments[1..])?;
            // One probe answers one question. A single invocation that checked
            // files *and* the network would report a combined exit code, and
            // the point of this tool is that each wall is reported separately.
            if let Some(target) = options.get("--connect") {
                return Ok(probe::connect(target));
            }
            if let Some(host) = options.get("--resolve") {
                return Ok(probe::resolve(host));
            }
            probe::run(options.required("--path")?)
        }
        "--help" | "-h" | "help" => {
            println!("{USAGE}");
            Ok(0)
        }
        other => Err(format!("unknown command: {other}\n\n{USAGE}")),
    }
}

/// `--flag value` pairs, plus everything after a bare `--`.
///
/// Hand-written rather than a crate. This binary is on the security path and
/// the parsing it needs is fifty lines; a dependency here would be more code
/// running with the harness's own rights than the feature itself.
struct Options<'a> {
    named: Vec<(&'a str, &'a str)>,
    trailing: Vec<String>,
}

impl<'a> Options<'a> {
    fn parse(arguments: &'a [String]) -> Result<Self, String> {
        let mut named = Vec::new();
        let mut trailing = Vec::new();
        let mut index = 0;

        while index < arguments.len() {
            let argument = arguments[index].as_str();
            if argument == "--" {
                // Everything past this point belongs to the child, including
                // anything that looks like one of our own flags.
                trailing = arguments[index + 1..].to_vec();
                break;
            }
            if !argument.starts_with("--") {
                return Err(format!("unexpected argument: {argument}"));
            }
            let Some(value) = arguments.get(index + 1) else {
                return Err(format!("{argument} needs a value"));
            };
            named.push((argument, value.as_str()));
            index += 2;
        }

        Ok(Self { named, trailing })
    }

    fn get(&self, name: &str) -> Option<&'a str> {
        self.named
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| *value)
    }

    /// Every value given for a flag, in order. Repeatable flags are the only
    /// honest shape for a list: a comma-separated string would need an escape
    /// rule the moment a value contained a comma.
    fn all(&self, name: &str) -> Vec<String> {
        self.named
            .iter()
            .filter(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_string())
            .collect()
    }

    fn required(&self, name: &str) -> Result<&'a str, String> {
        self.get(name).ok_or_else(|| format!("{name} is required"))
    }

    fn trailing(&self) -> &[String] {
        &self.trailing
    }
}
