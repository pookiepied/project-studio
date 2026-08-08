use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

#[derive(Clone)]
pub struct ControlState {
    endpoint: Arc<String>,
    token: Arc<String>,
}

#[tauri::command]
pub fn local_control_config(state: tauri::State<'_, ControlState>) -> Value {
    json!({ "url": state.endpoint.as_str(), "token": state.token.as_str() })
}

pub async fn start(app: AppHandle) -> Result<ControlState, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let state = ControlState { endpoint: Arc::new(format!("http://{}", address)), token: Arc::new(Uuid::new_v4().to_string()) };
    let task_state = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let app = app.clone();
            let state = task_state.clone();
            tauri::async_runtime::spawn(async move {
                let mut raw = Vec::new();
                let mut chunk = [0_u8; 4096];
                loop {
                    let Ok(n) = stream.read(&mut chunk).await else { return }; if n == 0 { return }
                    raw.extend_from_slice(&chunk[..n]);
                    if let Some(header_end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&raw[..header_end]);
                        let length = headers.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                        if raw.len() >= header_end + 4 + length { break }
                    }
                    if raw.len() > 1_048_576 { return }
                }
                let (status, body) = handle(&app, &state, &raw).await;
                let encoded = serde_json::to_vec(&body).unwrap_or_else(|_| b"{\"error\":\"serialization failed\"}".to_vec());
                let response = format!("HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", status, encoded.len());
                let _ = stream.write_all(response.as_bytes()).await; let _ = stream.write_all(&encoded).await;
            });
        }
    });
    Ok(state)
}

async fn handle(app: &AppHandle, state: &ControlState, raw: &[u8]) -> (&'static str, Value) {
    let Some(header_end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else { return ("400 Bad Request", json!({"error":"invalid request"})) };
    let headers = String::from_utf8_lossy(&raw[..header_end]);
    let mut lines = headers.lines(); let first = lines.next().unwrap_or("");
    let path = first.split_whitespace().nth(1).unwrap_or("");
    let authorized = lines.any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {}", state.token)));
    if !authorized { return ("401 Unauthorized", json!({"error":"unauthorized"})) }
    let Some(tool) = path.strip_prefix("/v1/tools/") else { return ("404 Not Found", json!({"error":"not found"})) };
    let args: Value = serde_json::from_slice(&raw[header_end + 4..]).unwrap_or_else(|_| json!({}));
    match dispatch(app, tool, args).await { Ok(v) => ("200 OK", v), Err(e) => ("400 Bad Request", json!({"error":e})) }
}

async fn dispatch(app: &AppHandle, tool: &str, args: Value) -> Result<Value, String> {
    let text = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("{} is required", key));
    let changed = || { let _ = app.emit("local-registry-changed", ()); };
    match tool {
        "mcp_list" => Ok(serde_json::to_value(crate::local_registry::local_registry_list(app.clone())?).map_err(|e|e.to_string())?),
        "mcp_remove" => { crate::local_registry::local_registry_remove(app.clone(), text("id")?)?; changed(); Ok(json!({"removed":true})) },
        "mcp_enable" | "mcp_disable" => { crate::local_registry::local_registry_set_enabled(app.clone(), text("id")?, tool=="mcp_enable")?; changed(); Ok(json!({"enabled":tool=="mcp_enable"})) },
        "mcp_add_remote" => { let v=crate::local_registry::local_registry_register_remote(app.clone(),None,text("name")?,text("endpoint")?,args.get("transport").and_then(Value::as_str).unwrap_or("streamable-http").into(),args.get("bearerToken").and_then(Value::as_str).map(str::to_owned),true).await?;changed();serde_json::to_value(v).map_err(|e|e.to_string()) },
        "mcp_add_stdio" => { let command=text("command")?;let vals=args.get("args").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|v|v.as_str().map(str::to_owned)).collect();let env=args.get("env").and_then(Value::as_object).map(|o|o.iter().filter_map(|(k,v)|v.as_str().map(|s|(k.clone(),s.to_owned()))).collect()).unwrap_or_default();let manager=app.state::<crate::mcp::McpManager>();let v=crate::local_registry::local_registry_register_stdio(app.clone(),manager,None,text("name")?,command,vals,env,true).await?;changed();serde_json::to_value(v).map_err(|e|e.to_string()) },
        "mcp_add_from_github" => Ok(json!({"requiresConfirmation":true,"repository":text("repository")?,"steps":["clone into a user-selected folder","review manifest and install scripts","install dependencies","register and verify tools"]})),
        "skill_list" | "skill_search" => Ok(serde_json::to_value(crate::local_registry::local_skill_list(app.clone())?).map_err(|e|e.to_string())?),
        "skill_read" => { let id=text("id")?;let skill=crate::local_registry::local_skill_list(app.clone())?.into_iter().find(|s|s.id==id).ok_or("skill not found")?;let content=std::fs::read_to_string(std::path::Path::new(&skill.local_path).join("SKILL.md")).map_err(|e|e.to_string())?;Ok(json!({"skill":skill,"instructions":content})) },
        "skill_register" | "skill_add" => { let v=crate::local_registry::local_skill_register(app.clone(),args.get("id").and_then(Value::as_str).map(str::to_owned),text("name")?,text("description")?,args.get("category").and_then(Value::as_str).map(str::to_owned),text("localPath")?,args.get("version").and_then(Value::as_str).map(str::to_owned),args.get("activationHint").and_then(Value::as_str).map(str::to_owned))?;changed();serde_json::to_value(v).map_err(|e|e.to_string()) },
        "skill_create" | "skill_update" => { if args.get("confirmed").and_then(Value::as_bool)!=Some(true){return Err("confirmed=true is required after reviewing the target path and instructions".into())}let path=std::path::PathBuf::from(text("localPath")?);std::fs::create_dir_all(&path).map_err(|e|e.to_string())?;let instructions=text("instructions")?;std::fs::write(path.join("SKILL.md"),instructions).map_err(|e|e.to_string())?;let v=crate::local_registry::local_skill_register(app.clone(),args.get("id").and_then(Value::as_str).map(str::to_owned),text("name")?,text("description")?,args.get("category").and_then(Value::as_str).map(str::to_owned),path.to_string_lossy().into_owned(),args.get("version").and_then(Value::as_str).map(str::to_owned),args.get("activationHint").and_then(Value::as_str).map(str::to_owned))?;changed();serde_json::to_value(v).map_err(|e|e.to_string()) },
        "skill_unregister" | "skill_remove" => { crate::local_registry::local_skill_unregister(app.clone(),text("id")?)?;changed();Ok(json!({"removed":true})) },
        "skill_run" | "mcp_reverify" => Err(format!("{} requires a declared executable manifest or stored transport configuration", tool)),
        _ => Err(format!("unknown control tool: {}", tool)),
    }
}
