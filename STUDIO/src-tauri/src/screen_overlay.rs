//! The window Studio draws on the person's screen with (ADR 0059).
//!
//! Two things are drawn there, by two hands. The agent's marks - a point, a
//! ring, a box, an arrow - come from its `studio_computer_mark` answers and
//! show for a few seconds while every click passes straight through. The
//! person's ink comes from "Show me": the same window stops passing clicks
//! through, a pen appears, and each stroke is summarised and sent to the
//! conversation that asked.
//!
//! One window, frameless and transparent, covering exactly one display at a
//! time, always on top, never focused and never in the taskbar - the same
//! rules as the "Studio is using your computer" pill, for the same reasons.
//! It is deliberately NOT hidden from screen capture: what the person drew
//! and what the agent pointed at belong in the next picture the agent takes.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The window's label. Covered by its own entry in `capabilities/default.json`.
pub const SCREEN_OVERLAY_LABEL: &str = "screen-overlay";
/// To the overlay: show (or clear) a set of the agent's marks.
const MARKS_EVENT: &str = "studio://screen-overlay/marks";
/// To the overlay: the person is about to draw on this display.
const DRAW_EVENT: &str = "studio://screen-overlay/draw";
/// To the app: shapes the person drew, with the conversation they are for.
const DRAWN_EVENT: &str = "studio://screen-overlay/drawn";
/// To the app: the person pressed Done.
const FINISHED_EVENT: &str = "studio://screen-overlay/finished";
/// To the overlay: drop everything and go quiet (the call ended, sharing stopped).
const RESET_EVENT: &str = "studio://screen-overlay/reset";

/// Where the window sits, in physical pixels, and the display's scale - what
/// the page needs to turn its CSS pixels into the desktop's and back.
#[derive(Clone, Serialize)]
pub struct MonitorPlace {
  x: i32,
  y: i32,
  width: u32,
  height: u32,
  scale: f64,
}

/// What the overlay should be showing, kept here so a window whose page is
/// still loading can ask for it instead of missing the event.
#[derive(Default)]
pub struct ScreenOverlay {
  conversation: Mutex<Option<String>>,
  drawing: Mutex<Option<MonitorPlace>>,
  marks: Mutex<Option<Value>>,
}

fn place_of(monitor: &Monitor) -> MonitorPlace {
  MonitorPlace {
    x: monitor.position().x,
    y: monitor.position().y,
    width: monitor.size().width,
    height: monitor.size().height,
    scale: monitor.scale_factor(),
  }
}

/// The display containing a desktop point, else the primary one.
fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<Monitor> {
  let monitors = app.available_monitors().unwrap_or_default();
  monitors
    .iter()
    .find(|monitor| {
      let position = monitor.position();
      let size = monitor.size();
      x >= position.x as f64
        && y >= position.y as f64
        && x < position.x as f64 + size.width as f64
        && y < position.y as f64 + size.height as f64
    })
    .cloned()
    .or_else(|| app.primary_monitor().ok().flatten())
}

/// The overlay, built hidden the first time it is needed and kept after.
fn overlay(app: &AppHandle) -> Result<WebviewWindow, String> {
  if let Some(existing) = app.get_webview_window(SCREEN_OVERLAY_LABEL) {
    return Ok(existing);
  }
  WebviewWindowBuilder::new(app, SCREEN_OVERLAY_LABEL, WebviewUrl::App("index.html?overlay=screen".into()))
    .title("Studio on your screen")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    // The pill's lesson (see `computer_indicator_show`): without this every
    // show after the first activates the window and takes the keyboard from
    // whatever the person or the agent is typing into.
    .focusable(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())
}

fn cover(window: &WebviewWindow, place: &MonitorPlace) {
  let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
  let _ = window.set_size(PhysicalSize::new(place.width, place.height));
}

/// Show one of the agent's mark sets (or clear them) on the display it names.
///
/// While the person is drawing the window stays where it is: their ink is
/// the point of that moment, and marks for another display are dropped by
/// the page rather than pulling the window away from under the pen.
#[tauri::command]
pub async fn screen_overlay_marks(app: AppHandle, set: Value) -> Result<(), String> {
  let state = app.state::<ScreenOverlay>();
  let clear = set.get("clear").and_then(Value::as_bool) == Some(true);
  let window = overlay(&app)?;
  let drawing = state.drawing.lock().map(|place| place.clone()).unwrap_or(None);
  let place = match &drawing {
    Some(place) => place.clone(),
    None => {
      let display = set.get("display").cloned().unwrap_or(Value::Null);
      let number = |key: &str| display.get(key).and_then(Value::as_f64).unwrap_or(0.0);
      let centre = (number("x") + number("width") / 2.0, number("y") + number("height") / 2.0);
      match monitor_at(&app, centre.0, centre.1) {
        Some(monitor) => place_of(&monitor),
        None => return Ok(()),
      }
    }
  };
  let payload = json!({ "monitor": place, "set": if clear { Value::Null } else { set } });
  if let Ok(mut marks) = state.marks.lock() {
    *marks = if clear { None } else { Some(payload.clone()) };
  }
  if !clear && drawing.is_none() {
    cover(&window, &place);
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.show();
  }
  window.emit_to(SCREEN_OVERLAY_LABEL, MARKS_EVENT, payload).map_err(|error| error.to_string())
}

/// "Show me": the window covers the display the pointer is on and takes the
/// pointer, so the person can draw on whatever is there.
#[tauri::command]
pub async fn screen_overlay_draw(app: AppHandle, conversation_id: String) -> Result<(), String> {
  let state = app.state::<ScreenOverlay>();
  if let Ok(mut current) = state.conversation.lock() {
    *current = Some(conversation_id);
  }
  let window = overlay(&app)?;
  let pointer = app.cursor_position().unwrap_or(PhysicalPosition::new(0.0, 0.0));
  let Some(monitor) = monitor_at(&app, pointer.x, pointer.y) else {
    return Err("No display was found to draw on.".into());
  };
  let place = place_of(&monitor);
  if let Ok(mut drawing) = state.drawing.lock() {
    *drawing = Some(place.clone());
  }
  cover(&window, &place);
  let _ = window.set_ignore_cursor_events(false);
  let _ = window.show();
  window.emit_to(SCREEN_OVERLAY_LABEL, DRAW_EVENT, json!({ "monitor": place })).map_err(|error| error.to_string())
}

/// What the overlay should show now: for a page that loaded after the event.
#[tauri::command]
pub async fn screen_overlay_state(app: AppHandle) -> Result<Value, String> {
  let state = app.state::<ScreenOverlay>();
  let drawing = state.drawing.lock().map(|place| place.clone()).unwrap_or(None);
  let marks = state.marks.lock().map(|marks| marks.clone()).unwrap_or(None);
  Ok(json!({ "drawing": drawing.map(|place| json!({ "monitor": place })), "marks": marks }))
}

/// From the overlay: shapes the person just drew, passed on with the conversation they belong to.
#[tauri::command]
pub async fn screen_overlay_drawn(app: AppHandle, shapes: Value) -> Result<(), String> {
  let conversation = app.state::<ScreenOverlay>().conversation.lock().ok().and_then(|current| current.clone());
  let Some(conversation) = conversation else {
    return Ok(());
  };
  app
    .emit(DRAWN_EVENT, json!({ "conversationId": conversation, "shapes": shapes }))
    .map_err(|error| error.to_string())
}

/// From the overlay: Done. Clicks pass through again; the ink fades on its own.
#[tauri::command]
pub async fn screen_overlay_finish(app: AppHandle) -> Result<(), String> {
  let state = app.state::<ScreenOverlay>();
  if let Ok(mut drawing) = state.drawing.lock() {
    *drawing = None;
  }
  if let Some(window) = app.get_webview_window(SCREEN_OVERLAY_LABEL) {
    let _ = window.set_ignore_cursor_events(true);
  }
  let conversation = state.conversation.lock().ok().and_then(|current| current.clone());
  match conversation {
    Some(conversation) => app.emit(FINISHED_EVENT, conversation).map_err(|error| error.to_string()),
    None => Ok(()),
  }
}

/// From the overlay: nothing left on screen, so the window goes away.
#[tauri::command]
pub async fn screen_overlay_idle(app: AppHandle) -> Result<(), String> {
  let state = app.state::<ScreenOverlay>();
  let drawing = state.drawing.lock().map(|place| place.is_some()).unwrap_or(false);
  if drawing {
    return Ok(());
  }
  if let Ok(mut marks) = state.marks.lock() {
    *marks = None;
  }
  if let Some(window) = app.get_webview_window(SCREEN_OVERLAY_LABEL) {
    let _ = window.hide();
  }
  Ok(())
}

/// From the app: the call ended or sharing stopped. Ink, marks and drawing all go.
#[tauri::command]
pub async fn screen_overlay_reset(app: AppHandle) -> Result<(), String> {
  let state = app.state::<ScreenOverlay>();
  if let Ok(mut drawing) = state.drawing.lock() {
    *drawing = None;
  }
  if let Ok(mut marks) = state.marks.lock() {
    *marks = None;
  }
  if let Ok(mut current) = state.conversation.lock() {
    *current = None;
  }
  if let Some(window) = app.get_webview_window(SCREEN_OVERLAY_LABEL) {
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.hide();
    let _ = window.emit_to(SCREEN_OVERLAY_LABEL, RESET_EVENT, Value::Null);
  }
  Ok(())
}
