use std::process::Command;

fn browser_command(url: &str) -> Result<Command, String> {
  let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid web address.".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
    return Err("Only web addresses can be opened.".into());
  }
  #[cfg(target_os = "windows")]
  let mut command = {
    use std::os::windows::process::CommandExt;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = [0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    if length == 0 || length >= buffer.len() {
      return Err("The Windows system directory is unavailable.".into());
    }
    let system = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length]));
    // Neither the workspace nor PATH may select the executable or its DLL.
    let mut command = Command::new(system.join("rundll32.exe"));
    command.current_dir(system);
    command.arg("url.dll,FileProtocolHandler").arg(parsed.as_str());
    command.creation_flags(0x08000000);
    command
  };
  #[cfg(target_os = "macos")]
  let mut command = { let mut c = Command::new("/usr/bin/open"); c.arg("--").arg(parsed.as_str()); c };
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  let mut command = { let mut c = Command::new("/usr/bin/xdg-open"); c.arg(parsed.as_str()); c };
  command.env_remove("PATH");
  Ok(command)
}

/// Open a web result through the OS, without evaluating a shell command.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
  run_browser_command(browser_command(&url)?).await
}

async fn run_browser_command(mut command: Command) -> Result<(), String> {
  // Waiting off the UI thread both reports helper failures and reaps Unix children.
  let status = tauri::async_runtime::spawn_blocking(move || command.status()).await
    .map_err(|_| "The browser launcher stopped unexpectedly.".to_string())?
    .map_err(|error| format!("Could not open the browser: {error}"))?;
  if !status.success() {
    return Err(format!("The browser launcher exited unsuccessfully ({status})."));
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn browser_launcher_waits_for_and_reports_the_helper_outcome() {
    for (argument, success) in [("--help", true), ("--studio-invalid-browser-helper-option", false)] {
      let mut command = Command::new(std::env::current_exe().expect("fixture executable"));
      command.arg(argument).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
      assert_eq!(run_browser_command(command).await.is_ok(), success);
    }
  }

  #[test]
  fn browser_launcher_is_absolute_and_keeps_the_url_in_one_argument() {
    let url = "https://example.com/a?value=one%20two&other=three";
    let command = browser_command(url).expect("web command");
    assert!(std::path::Path::new(command.get_program()).is_absolute());
    assert_eq!(command.get_args().last(), Some(std::ffi::OsStr::new(url)));
    assert!(command.get_envs().any(|(key, value)| key == "PATH" && value.is_none()));
    #[cfg(target_os = "windows")]
    {
      let directory = command.get_current_dir().expect("system working directory");
      assert_eq!(directory.join("rundll32.exe"), std::path::Path::new(command.get_program()));
      assert!(directory.join("url.dll").is_file());
    }
  }

  #[test]
  fn browser_launcher_rejects_non_web_targets_before_starting_a_process() {
    for url in ["javascript:alert(1)", "file:///C:/secret", "data:text/html,test", "invalid"] {
      assert!(browser_command(url).is_err());
    }
  }
}
