use serde::Serialize;
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
        return Ok(GitCheckoutResult {
            branch,
            path: worktree_path,
        });
    }
    git(&path, &["switch", &branch])?;
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
