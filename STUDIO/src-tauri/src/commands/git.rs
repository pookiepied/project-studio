use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub worktree_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutResult {
    pub branch: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub branch: String,
    pub has_repo: bool,
    pub files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub hash: String,
    pub subject: String,
}

fn git(path: &str, args: &[&str]) -> Result<String, String> {
    if !Path::new(path).is_dir() {
        return Err("The project folder does not exist".into());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Git command failed".into()
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_dynamic(path: &str, args: &[String]) -> Result<String, String> {
    if !Path::new(path).is_dir() {
        return Err("The project folder does not exist".into());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Git command failed".into()
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn worktrees(path: &str) -> Result<Vec<(String, String)>, String> {
    let output = git(path, &["worktree", "list", "--porcelain"])?;
    let mut result = Vec::new();
    let mut worktree_path: Option<String> = None;
    for line in output.lines().chain(std::iter::once("")) {
        if let Some(value) = line.strip_prefix("worktree ") {
            worktree_path = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
            if let Some(current_path) = worktree_path.take() {
                result.push((value.to_string(), current_path));
            }
        } else if line.is_empty() {
            worktree_path = None;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn git_status_summary(path: String) -> Result<GitStatusSummary, String> {
    if git(&path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(GitStatusSummary {
            branch: String::new(),
            has_repo: false,
            files: Vec::new(),
        });
    }

    let branch = git(&path, &["branch", "--show-current"]).unwrap_or_default();
    let output = git(&path, &["status", "--short"])?;
    let files = output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let status = line[..2].to_string();
            let raw_path = line[3..].trim();
            let path = raw_path
                .split(" -> ")
                .last()
                .unwrap_or(raw_path)
                .to_string();
            let mut chars = status.chars();
            let index = chars.next().unwrap_or(' ');
            let worktree = chars.next().unwrap_or(' ');
            let untracked = status == "??";
            Some(GitChangedFile {
                path,
                status,
                staged: !untracked && index != ' ',
                unstaged: !untracked && worktree != ' ',
                untracked,
            })
        })
        .collect();

    Ok(GitStatusSummary {
        branch,
        has_repo: true,
        files,
    })
}

#[tauri::command]
pub async fn git_diff(
    path: String,
    file_path: Option<String>,
    staged: bool,
    ignore_whitespace: bool,
) -> Result<String, String> {
    if !staged {
        if let Some(file_path) = file_path.as_ref() {
            if !file_path.trim().is_empty()
                && git(&path, &["ls-files", "--error-unmatch", file_path]).is_err()
            {
                let full_path = Path::new(&path).join(file_path);
                let content = fs::read_to_string(&full_path)
                    .map_err(|error| format!("Could not read untracked file: {error}"))?;
                let mut diff = format!(
                    "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n",
                    file_path,
                    content.lines().count(),
                );
                for line in content.lines() {
                    diff.push('+');
                    diff.push_str(line);
                    diff.push('\n');
                }
                return Ok(diff);
            }
        }
    }

    let mut args = vec!["diff".to_string(), "--no-color".to_string()];
    if staged {
        args.push("--cached".to_string());
    }
    if ignore_whitespace {
        args.push("-w".to_string());
    }
    if let Some(file_path) = file_path {
        if !file_path.trim().is_empty() {
            args.push("--".to_string());
            args.push(file_path);
        }
    }
    git_dynamic(&path, &args)
}

#[tauri::command]
pub async fn git_recent_commits(path: String) -> Result<Vec<GitCommitSummary>, String> {
    let output = git(&path, &["log", "--oneline", "-n", "12"])?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once(' ')?;
            Some(GitCommitSummary {
                hash: hash.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn git_stage(path: String, file_path: Option<String>) -> Result<(), String> {
    let mut args = vec!["add".to_string()];
    if let Some(file_path) = file_path {
        if !file_path.trim().is_empty() {
            args.push("--".to_string());
            args.push(file_path);
        } else {
            args.push("-A".to_string());
        }
    } else {
        args.push("-A".to_string());
    }
    git_dynamic(&path, &args).map(|_| ())
}

#[tauri::command]
pub async fn git_unstage(path: String, file_path: Option<String>) -> Result<(), String> {
    let mut args = vec!["restore".to_string(), "--staged".to_string()];
    if let Some(file_path) = file_path {
        if !file_path.trim().is_empty() {
            args.push("--".to_string());
            args.push(file_path);
        } else {
            args.push(".".to_string());
        }
    } else {
        args.push(".".to_string());
    }
    git_dynamic(&path, &args).map(|_| ())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("Enter a commit message".into());
    }
    git(&path, &["commit", "-m", &message])
}

#[tauri::command]
pub async fn git_list_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let current = git(&path, &["branch", "--show-current"])?;
    let branch_names = git(
        &path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    let checked_out = worktrees(&path)?;
    Ok(branch_names
        .lines()
        .filter(|name| !name.is_empty())
        .map(|name| GitBranch {
            name: name.to_string(),
            current: name == current,
            worktree_path: checked_out
                .iter()
                .find(|(branch, _)| branch == name)
                .map(|(_, path)| path.clone()),
        })
        .collect())
}

#[tauri::command]
pub async fn git_checkout_branch(
    path: String,
    branch: String,
) -> Result<GitCheckoutResult, String> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("Choose a branch".into());
    }
    if let Some((_, worktree_path)) = worktrees(&path)?
        .into_iter()
        .find(|(name, _)| name == &branch)
    {
        let current_path = std::fs::canonicalize(&path).unwrap_or_else(|_| Path::new(&path).to_path_buf());
        let target_path = std::fs::canonicalize(&worktree_path).unwrap_or_else(|_| Path::new(&worktree_path).to_path_buf());
        if current_path != target_path {
            return Err(format!("This branch is already open in another worktree:\n{worktree_path}"));
        }
    }
    if let Err(message) = git(&path, &["switch", &branch]) {
        if message.contains("would be overwritten by checkout") || message.contains("would be overwritten by merge") {
            return Err("Local changes overlap with that branch. Commit or stash them before switching.".into());
        }
        return Err(message.lines().next().unwrap_or("Git could not switch branches").to_string());
    }
    Ok(GitCheckoutResult { branch, path })
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch: String) -> Result<GitCheckoutResult, String> {
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("Enter a branch name".into());
    }
    git(&path, &["check-ref-format", "--branch", &branch])?;
    git(&path, &["switch", "-c", &branch])?;
    Ok(GitCheckoutResult { branch, path })
}
