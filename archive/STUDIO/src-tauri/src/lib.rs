use tauri::{Manager, WindowEvent, State, AppHandle, Emitter};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, TrayIcon};
use std::sync::Mutex;

mod commands;
mod mcp;
mod local_registry;
mod control_server;
mod daemon;
mod pty;
mod native_browser;
use commands::*;
use daemon::{DaemonHandle};
use pty::{pty_close, pty_create, pty_resize, pty_write};
use native_browser::{
    native_browser_back,
    native_browser_clear_data,
    native_browser_close,
    native_browser_create,
    native_browser_forward,
    native_browser_hide,
    native_browser_navigate,
    native_browser_reload,
    native_browser_set_bounds,
    native_browser_set_zoom,
    native_browser_show,
};
use mcp::{
    mcp_start_server, mcp_stop_server, mcp_call_tool,
    mcp_get_tools, mcp_list_running, mcp_run_setup,
    mcp_resolve_studio_harness_server_path,
    mcp_resolve_computer_use_server_path,
    mcp_resolve_bundled_server_path,
    mcp_resolve_mcp_management_server_path,
    mcp_resolve_skill_management_server_path,
    mcp_resolve_skill_execution_server_path,
};

// Store tray icon reference
struct TrayState {
    tray: Mutex<Option<TrayIcon>>,
}

struct StartupVisibilityState {
    should_show_on_ready: bool,
}

#[tauri::command]
async fn update_tray_menu(
    app: AppHandle,
    state: State<'_, TrayState>,
    is_recording: bool,
    has_text: bool,
) -> Result<(), String> {
    println!("[Tray] Updating menu: recording={}, has_text={}", is_recording, has_text);
    
    // Build menu items based on state
    let recording_item = if is_recording {
        MenuItem::with_id(&app, "stop_recording", "Stop Recording", true, None::<&str>)
            .map_err(|e| e.to_string())?
    } else {
        MenuItem::with_id(&app, "start_recording", "Start Recording", true, None::<&str>)
            .map_err(|e| e.to_string())?
    };
    
    let new_item = MenuItem::with_id(&app, "new_transcription", "New Transcription", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    
    let show_item = MenuItem::with_id(&app, "show", "Show STUDIO", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    
    let quit_item = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    
    // Create menu with or without copy button
    let menu = if has_text {
        let copy_item = MenuItem::with_id(&app, "copy_text", "Copy Text", true, None::<&str>)
            .map_err(|e| e.to_string())?;
        Menu::with_items(&app, &[&recording_item, &copy_item, &new_item, &show_item, &quit_item])
            .map_err(|e| e.to_string())?
    } else {
        Menu::with_items(&app, &[&recording_item, &new_item, &show_item, &quit_item])
            .map_err(|e| e.to_string())?
    };
    
    // Update tray
    let tray_state = state.tray.lock().unwrap();
    if let Some(tray) = tray_state.as_ref() {
        tray.set_menu(Some(menu))
            .map_err(|e| e.to_string())?;
        println!("[Tray] Menu updated successfully");
    }
    
    Ok(())
}

#[tauri::command]
async fn app_ready(app: AppHandle, startup: State<'_, StartupVisibilityState>) -> Result<(), String> {
    println!("[App] Frontend ready, showing window");
    if !startup.should_show_on_ready {
        return Ok(());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// Patch the WebView2 profile's `Preferences` JSON **before** WebView2 reads
/// it on startup so microphone access is silently pre-granted.
///
/// WebView2 (Chromium-based) stores permission decisions in:
///   `%LOCALAPPDATA%\com.pookiepied.studio\EBWebView\Default\Preferences`
///
/// When a permission prompt is dismissed 3 times the browser activates an
/// "embargo" (`permission_autoblocking_data`) that silently blocks all future
/// requests for that permission — `PermissionRequested` is never fired again.
/// Editing the file before the WebView2 process launches clears the embargo
/// and pre-sets mic to ALLOW, which is the only reliable way to unblock it.
///
/// This must be called at the very start of `run()`, **before**
/// `tauri::Builder::default()`, so no WebView2 process has started yet.
#[cfg(target_os = "windows")]
fn patch_webview2_mic_permissions() {
    let local_app_data = match std::env::var("LOCALAPPDATA") {
        Ok(v) => std::path::PathBuf::from(v),
        Err(_) => return,
    };

    let pref_path = local_app_data
        .join("com.pookiepied.studio")
        .join("EBWebView")
        .join("Default")
        .join("Preferences");

    if !pref_path.exists() {
        // First ever launch — file doesn't exist yet; WebView2 will create it
        // with defaults and our PermissionRequested handler will grant mic on
        // the initial prompt (no embargo yet on a fresh profile).
        return;
    }

    let content = match std::fs::read_to_string(&pref_path) {
        Ok(c) => c,
        Err(e) => { println!("[Permissions] Could not read Preferences: {}", e); return; }
    };

    let mut prefs: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => { println!("[Permissions] Could not parse Preferences: {}", e); return; }
    };

    // Every origin the app may run on (dev server + production protocol)
    let origins = [
        "http://localhost:1420,*",     // Vite dev server
        "http://tauri.localhost:80,*", // Tauri production (http variant)
        "tauri://localhost,*",         // Tauri production (custom scheme)
    ];

    let exceptions = &mut prefs["profile"]["content_settings"]["exceptions"];

    // 1. Clear the Chromium permission embargo that prevents PermissionRequested
    //    from firing when a prompt has been dismissed ≥3 times.
    if let Some(obj) = exceptions["permission_autoblocking_data"].as_object_mut() {
        for origin in &origins {
            obj.remove(*origin);
        }
    }

    // 2. Pre-set mic to ALLOW (setting: 1) for every local origin.
    //    Chromium's content_settings format: {"setting": 1} = CONTENT_SETTING_ALLOW
    if !exceptions["media_stream_mic"].is_object() {
        exceptions["media_stream_mic"] = serde_json::json!({});
    }
    for origin in &origins {
        exceptions["media_stream_mic"][origin] = serde_json::json!({
            "last_modified": "13422900000000000",
            "setting": 1
        });
    }

    match serde_json::to_string(&prefs) {
        Ok(patched) => match std::fs::write(&pref_path, patched) {
            Ok(_)  => println!("[Permissions] WebView2 mic embargo cleared, permission pre-granted"),
            Err(e) => println!("[Permissions] Could not write Preferences: {}", e),
        },
        Err(e) => println!("[Permissions] Could not serialize Preferences: {}", e),
    }
}

/// Reactive safety-net: if the embargo is absent but no cached decision exists
/// (e.g. fresh profile), catch `PermissionRequested` and grant mic silently.
/// Called once the window + WebView2 are ready inside `setup`.
#[cfg(target_os = "windows")]
fn setup_webview2_mic_handler(window: &tauri::WebviewWindow) {
    use webview2_com::{
        PermissionRequestedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
    };

    let _ = window.with_webview(|webview| unsafe {
        let core = webview.controller().CoreWebView2().unwrap();
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut kind = Default::default();
                    let _ = args.PermissionKind(&mut kind);
                    if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                    }
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Patch the WebView2 Preferences file BEFORE the builder launches WebView2,
    // clearing any microphone embargo and pre-granting permission for all local
    // origins (dev server + production). Must be the very first thing in run().
    #[cfg(target_os = "windows")]
    patch_webview2_mic_permissions();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize secure storage on startup
            println!("[App] Initializing secure storage...");
            if let Err(e) = commands::init_secure_storage_sync() {
                println!("[App] Warning: Failed to initialize secure storage: {}", e);
            }
            
            // Check if app was started with --minimized flag (autostart on boot)
            let args: Vec<String> = std::env::args().collect();
            let is_minimized_start = args.iter().any(|arg| arg == "--minimized");
            
            println!("[App] Starting STUDIO (minimized: {})", is_minimized_start);
            
            // Create initial system tray menu
            let start_item = MenuItem::with_id(app, "start_recording", "Start Recording", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show STUDIO", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start_item, &show_item, &quit_item])?;

            // Create system tray icon
            let icon = app.default_window_icon()
                .ok_or_else(|| "Failed to load application icon")?
                .clone();
            
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    println!("[Tray] Menu event: {}", event.id.as_ref());
                    match event.id.as_ref() {
                        "start_recording" => {
                            // Emit event to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-start-recording", ());
                            }
                        }
                        "stop_recording" => {
                            // Emit event to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-stop-recording", ());
                            }
                        }
                        "copy_text" => {
                            // Emit event to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-copy-text", ());
                            }
                        }
                        "new_transcription" => {
                            // Emit event to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-new-transcription", ());
                            }
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.state::<DaemonHandle>().stop(app.clone());
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(app) = tray.app_handle().get_webview_window("main") {
                            let _ = app.show();
                            let _ = app.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Store tray in state
            app.manage(TrayState {
                tray: Mutex::new(Some(tray)),
            });
            app.manage(StartupVisibilityState {
                should_show_on_ready: !is_minimized_start,
            });

            // Register the MCP manager. Servers are started on-demand from the
            // Settings UI — nothing auto-starts until the user configures a server.
            app.manage(mcp::McpManager::new());
            let control = tauri::async_runtime::block_on(control_server::start(app.handle().clone()))
                .map_err(|error| Box::<dyn std::error::Error>::from(std::io::Error::other(error)))?;
            app.manage(control);

            // Register the Local Provider Daemon. The daemon is started on-demand
            // from the Settings UI for Ollama/LM Studio integration.
            app.manage(daemon::DaemonHandle::new());

            // Register the PTY session store.
            app.manage(pty::new_store());

            // Handle window close event (minimize to tray instead of closing)
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent default close behavior
                        api.prevent_close();
                        // Hide window instead
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
                
                // Reactive fallback: grant mic via PermissionRequested handler
                // (catches fresh profiles where no cached decision exists yet).
                #[cfg(target_os = "windows")]
                setup_webview2_mic_handler(&window);

                // Zen shell: let Windows own the real outer silhouette. The
                // window is intentionally opaque; this avoids the transparent-host
                // reload flicker/extrusion while preserving native rounded corners.
                #[cfg(target_os = "windows")]
                {
                    if let Ok(hwnd) = window.hwnd() {
                        use windows::Win32::Graphics::Dwm::{
                            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE,
                            DWMWA_BORDER_COLOR, DWMWCP_ROUND,
                            DWM_WINDOW_CORNER_PREFERENCE,
                        };
                        let pref = DWMWCP_ROUND;
                        // Ask DWM for rounded corners but suppress its visible
                        // frame border so the shell stays visually quiet.
                        let border_color_none: u32 = 0xFFFFFFFE;
                        unsafe {
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE,
                                &pref as *const DWM_WINDOW_CORNER_PREFERENCE as *const core::ffi::c_void,
                                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                            );
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_BORDER_COLOR,
                                &border_color_none as *const u32 as *const core::ffi::c_void,
                                std::mem::size_of::<u32>() as u32,
                            );
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_tray_menu,
            app_ready,
            execute_shell_command,
            git_list_branches,
            git_checkout_branch,
            git_create_branch,
            git_status_summary,
            git_diff,
            git_recent_commits,
            git_stage,
            git_unstage,
            git_commit,
            claude_bridge_start,
            claude_bridge_stop,
            execute_pip_with_progress,
            save_audio_to_temp,
            get_directory_size,
            get_platform_os,
            get_platform_arch,
            file_exists,
            get_home_dir,
            get_studio_home_dir,
            read_text_file,
            read_text_file_preview,
            list_directory_entries,
            write_text_file,
            create_directory,
            delete_directory,
            start_oauth_server,
            update_csp_for_domain,
            reset_csp_to_default,
            get_current_csp,
            init_secure_storage,
            store_secure,
            get_secure,
            remove_secure,
            launch_chrome_debug,
            check_chrome_debug,
            mcp_start_server,
            mcp_stop_server,
            mcp_call_tool,
            mcp_get_tools,
            mcp_list_running,
            mcp_run_setup,
            mcp_resolve_studio_harness_server_path,
            mcp_resolve_computer_use_server_path,
            mcp_resolve_bundled_server_path,
            mcp_resolve_mcp_management_server_path,
            mcp_resolve_skill_management_server_path,
            mcp_resolve_skill_execution_server_path,
            local_registry::local_registry_register_stdio,
            local_registry::local_registry_register_remote,
            local_registry::local_registry_list,
            local_registry::local_registry_remove,
            local_registry::local_registry_set_enabled,
            local_registry::local_skill_register,
            local_registry::local_skill_unregister,
            local_registry::local_skill_list,
            local_registry::local_registry_sync_payload,
            control_server::local_control_config,
            local_provider_start,
            local_provider_stop,
            local_provider_is_running,
            local_provider_port,
            shell_exec_streaming,
            shell_resolve_cwd,
            pty_create,
            pty_write,
            pty_resize,
            pty_close,
            native_browser_create,
            native_browser_set_bounds,
            native_browser_show,
            native_browser_hide,
            native_browser_close,
            native_browser_navigate,
            native_browser_reload,
            native_browser_back,
            native_browser_forward,
            native_browser_set_zoom,
            native_browser_clear_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
