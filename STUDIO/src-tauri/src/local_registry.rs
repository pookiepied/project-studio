use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use crate::mcp::McpManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpRegistration {
    pub id: String, pub name: String, pub transport: String, pub enabled: bool,
    pub available: bool, pub credential_ref: Option<String>, pub tools: Vec<Value>,
    pub verified_at: Option<String>, pub auto_reconnect: bool,
}

fn open(app:&AppHandle)->Result<Connection,String>{
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 let db=Connection::open(dir.join("studio-registry.sqlite3")).map_err(|e|e.to_string())?;
 db.execute_batch("CREATE TABLE IF NOT EXISTS mcp_registrations(id TEXT PRIMARY KEY,name TEXT NOT NULL,transport TEXT NOT NULL,private_config TEXT NOT NULL,credential_ref TEXT,tools TEXT NOT NULL DEFAULT '[]',enabled INTEGER NOT NULL,available INTEGER NOT NULL,auto_reconnect INTEGER NOT NULL,verified_at TEXT,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS registry_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|e|e.to_string())?;Ok(db)
}

#[tauri::command]
pub async fn local_registry_register_stdio(app:AppHandle,state:tauri::State<'_,McpManager>,id:Option<String>,name:String,command:String,args:Vec<String>,env_vars:HashMap<String,String>,auto_reconnect:bool)->Result<LocalMcpRegistration,String>{
 let id=id.unwrap_or_else(||Uuid::new_v4().to_string());state.start(&id,&command,&args,&env_vars).await?;let manifest=state.get_tools(&id).await?;let tools=manifest.get("tools").and_then(Value::as_array).cloned().unwrap_or_default();
 let config=json!({"command":command,"args":args,"envKeys":env_vars.keys().collect::<Vec<_>>()});persist(&app,&id,&name,"stdio",&config,None,&tools,true,true,auto_reconnect)?;get(&app,&id)
}

#[tauri::command]
pub async fn local_registry_register_remote(app:AppHandle,id:Option<String>,name:String,endpoint:String,transport:String,bearer_token:Option<String>,auto_reconnect:bool)->Result<LocalMcpRegistration,String>{
 let id=id.unwrap_or_else(||Uuid::new_v4().to_string());let credential_ref=if let Some(token)=bearer_token{let key=format!("mcp/{}",id);keyring::Entry::new("com.pookiepied.studio",&key).map_err(|e|e.to_string())?.set_password(&token).map_err(|e|e.to_string())?;Some(format!("studio://secrets/{}",key))}else{None};
 let client=reqwest::Client::new();let mut req=client.post(&endpoint).json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}));if let Some(r)=&credential_ref{let key=r.trim_start_matches("studio://secrets/");let token=keyring::Entry::new("com.pookiepied.studio",key).map_err(|e|e.to_string())?.get_password().map_err(|e|e.to_string())?;req=req.bearer_auth(token)}let response=req.send().await.map_err(|e|e.to_string())?;if !response.status().is_success(){return Err(format!("MCP verification failed ({})",response.status()))}let body:Value=response.json().await.map_err(|e|e.to_string())?;let tools=body.pointer("/result/tools").and_then(Value::as_array).cloned().unwrap_or_default();if tools.is_empty(){return Err("MCP verification returned no valid tools".into())}
 persist(&app,&id,&name,&transport,&json!({"endpoint":endpoint}),credential_ref.as_deref(),&tools,true,true,auto_reconnect)?;get(&app,&id)
}

#[tauri::command] pub fn local_registry_list(app:AppHandle)->Result<Vec<LocalMcpRegistration>,String>{let db=open(&app)?;let mut stmt=db.prepare("SELECT id,name,transport,enabled,available,credential_ref,tools,verified_at,auto_reconnect FROM mcp_registrations ORDER BY name").map_err(|e|e.to_string())?;let rows=stmt.query_map([],|r|Ok(LocalMcpRegistration{id:r.get(0)?,name:r.get(1)?,transport:r.get(2)?,enabled:r.get::<_,i64>(3)?!=0,available:r.get::<_,i64>(4)?!=0,credential_ref:r.get(5)?,tools:serde_json::from_str(&r.get::<_,String>(6)?).unwrap_or_default(),verified_at:r.get(7)?,auto_reconnect:r.get::<_,i64>(8)?!=0})).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())}
#[tauri::command] pub fn local_registry_remove(app:AppHandle,id:String)->Result<(),String>{open(&app)?.execute("DELETE FROM mcp_registrations WHERE id=?",[id]).map_err(|e|e.to_string())?;Ok(())}
#[tauri::command]
pub fn local_registry_sync_payload(app:AppHandle,user_id:String,machine_id:String)->Result<Value,String>{
 let records=local_registry_list(app.clone())?;let db=open(&app)?;
 let revision:i64=db.query_row("SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM registry_state WHERE key='revision'),0)+1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 db.execute("INSERT INTO registry_state(key,value) VALUES('revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[revision.to_string()]).map_err(|e|e.to_string())?;
 let bundles=[("studio-harness","Studio Harness"),("computer-use","Computer Use")].into_iter().map(|(id,name)|json!({"ref":{"id":id,"kind":"bundle","name":name},"userId":user_id,"origin":"studio","location":"local","enabled":true,"available":true,"permissions":[],"metadata":{"builtIn":true},"bundleType":"mcp-server","runtime":"node","tools":[]})).collect::<Vec<_>>();
 let servers=records.into_iter().map(|r|json!({"ref":{"id":r.id,"kind":"mcp-server","name":r.name},"userId":user_id,"origin":"user","location":"local","enabled":r.enabled,"available":r.available,"permissions":[],"metadata":{},"transport":r.transport,"tools":r.tools.into_iter().map(normalize_tool).collect::<Vec<_>>(),"localRegistrationId":r.id,"verifiedAt":r.verified_at})).collect::<Vec<_>>();
 Ok(json!({"userId":user_id,"machineId":machine_id,"revision":revision,"bundles":bundles,"mcpServers":servers}))
}

fn normalize_tool(v:Value)->Value{json!({"name":v.get("name").and_then(Value::as_str).unwrap_or("unknown"),"description":v.get("description").and_then(Value::as_str).unwrap_or(""),"inputSchema":v.get("inputSchema").or_else(||v.get("input_schema")).cloned().unwrap_or(json!({"type":"object"})),"enabled":true})}
fn persist(app:&AppHandle,id:&str,name:&str,transport:&str,config:&Value,credential_ref:Option<&str>,tools:&[Value],enabled:bool,available:bool,auto_reconnect:bool)->Result<(),String>{open(app)?.execute("INSERT INTO mcp_registrations(id,name,transport,private_config,credential_ref,tools,enabled,available,auto_reconnect,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,transport=excluded.transport,private_config=excluded.private_config,credential_ref=excluded.credential_ref,tools=excluded.tools,enabled=excluded.enabled,available=excluded.available,auto_reconnect=excluded.auto_reconnect,verified_at=datetime('now'),updated_at=datetime('now')",params![id,name,transport,config.to_string(),credential_ref,serde_json::to_string(tools).unwrap(),enabled as i32,available as i32,auto_reconnect as i32]).map_err(|e|e.to_string())?;Ok(())}
fn get(app:&AppHandle,id:&str)->Result<LocalMcpRegistration,String>{local_registry_list(app.clone())?.into_iter().find(|r|r.id==id).ok_or_else(||"registration not found".into())}
