use tauri::{
    LogicalPosition, LogicalSize, Manager, WebviewUrl,
    webview::WebviewBuilder,
};

fn get_browser_webview(app: &tauri::AppHandle, label: &str) -> Result<tauri::Webview, String> {
    app
        .get_webview(label)
        .ok_or_else(|| format!("Native browser webview '{}' was not found", label))
}

fn parse_browser_url(url: Option<String>) -> Result<WebviewUrl, String> {
    let value = url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| "about:blank".to_string());

    value
        .parse()
        .map(WebviewUrl::External)
        .map_err(|e| format!("Invalid browser URL '{}': {}", value, e))
}

#[tauri::command]
pub async fn native_browser_create(
    app: tauri::AppHandle,
    label: String,
    url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_bounds(tauri::Rect {
                position: LogicalPosition::new(x, y).into(),
                size: LogicalSize::new(width, height).into(),
            })
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        if let Some(url) = url.filter(|u| !u.trim().is_empty()) {
            native_browser_navigate(app, label, url).await?;
        }
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window was not found".to_string())?;
    let builder = WebviewBuilder::new(label, parse_browser_url(url)?)
        .zoom_hotkeys_enabled(true);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    webview.set_auto_resize(false).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn native_browser_set_bounds(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = get_browser_webview(&app, &label)?;
    webview
        .set_bounds(tauri::Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_show(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_hide(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .hide()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_close(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .close()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    let url = url
        .parse()
        .map_err(|e| format!("Invalid browser URL '{}': {}", url, e))?;
    get_browser_webview(&app, &label)?
        .navigate(url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .reload()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_back(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .eval("window.history.back();")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_forward(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .eval("window.history.forward();")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_set_zoom(
    app: tauri::AppHandle,
    label: String,
    zoom: f64,
) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .set_zoom(zoom)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_browser_clear_data(app: tauri::AppHandle, label: String) -> Result<(), String> {
    get_browser_webview(&app, &label)?
        .clear_all_browsing_data()
        .map_err(|e| e.to_string())
}
