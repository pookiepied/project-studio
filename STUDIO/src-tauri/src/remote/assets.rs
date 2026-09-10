//! Serving the frontend to a device.
//!
//! There is no second build and no copy of the UI on disk for this. The
//! bundle Tauri already embedded in the executable for the desktop window is
//! the bundle a phone loads, read back out through Tauri's own
//! [`AssetResolver`]. One build, one frontend, one set of bugs — the
//! constraint ADR 0050 §3.2 is written to hold.
//!
//! [`AssetResolver`]: tauri::AssetResolver

use hyper::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
use hyper::{Response, StatusCode};
use tauri::{AppHandle, Runtime};

use super::body::RemoteBody;

/// How long a build-stamped asset may be cached.
///
/// Vite gives every file under `/assets/` a content hash in its name, so a
/// change is a new name and a stale answer is impossible. Everything else —
/// `index.html` above all — must not be cached at all, or a device keeps
/// loading the previous build's entry point after Studio updates and the
/// hashed files it names are gone.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const NEVER: &str = "no-cache, no-store, must-revalidate";

/// The document served for any address that is not a file.
const INDEX: &str = "index.html";

/// Serves one frontend file, or the app shell.
///
/// Falls back to `index.html` for a path with no file extension, which is
/// what makes a device that reloads on a deep link get Studio rather than a
/// 404. A path that does look like a file and is not there is a genuine 404:
/// answering those with HTML instead would turn a missing script into a page
/// that fails later and less clearly.
pub(crate) fn serve<R: Runtime>(app: &AppHandle<R>, path: &str) -> Response<RemoteBody> {
    let trimmed = path.trim_start_matches('/');
    let wanted = if trimmed.is_empty() { INDEX } else { trimmed };

    if let Some(response) = read(app, wanted) {
        return response;
    }
    if looks_like_a_file(wanted) {
        return not_found();
    }
    read(app, INDEX).unwrap_or_else(|| {
        // Reached only if the bundle has no `index.html`, which means the
        // frontend was never built into this binary. Saying so is far more
        // use than an empty 404 that reads like a routing mistake.
        let mut response = Response::new(RemoteBody::full(
            "Studio's frontend is not in this build.",
        ));
        *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        response
    })
}

fn read<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<Response<RemoteBody>> {
    let asset = app.asset_resolver().get(path.to_owned())?;
    let cache = if is_build_stamped(path) { IMMUTABLE } else { NEVER };

    let mut response = Response::new(RemoteBody::full(asset.bytes));
    let headers = response.headers_mut();
    if let Ok(mime) = HeaderValue::from_str(&asset.mime_type) {
        headers.insert(CONTENT_TYPE, mime);
    }
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache));
    // A file served to a device is served with its declared type and no
    // guessing. Without this a browser may sniff a `.json` or a stray text
    // file as something executable.
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    // Nothing here belongs in a frame on somebody else's page.
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    // The address of this listener is a private one. It has no business
    // travelling to any site the device visits afterwards.
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("no-referrer"),
    );
    Some(response)
}

/// Whether a path carries a content hash, and so can never go stale.
///
/// Deliberately narrow: only Vite's own output directory. A future asset
/// served from elsewhere is then merely uncached rather than wrongly cached
/// forever, and "wrongly cached forever" is the one of those two that cannot
/// be fixed from this side.
fn is_build_stamped(path: &str) -> bool {
    path.starts_with("assets/")
}

/// Whether a path names a file rather than a place in the app.
fn looks_like_a_file(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|last| last.contains('.'))
}

fn not_found() -> Response<RemoteBody> {
    let mut response = Response::new(RemoteBody::full("Not found."));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_with_an_extension_is_a_file_and_one_without_is_a_place() {
        assert!(looks_like_a_file("assets/index-a1b2c3.js"));
        assert!(looks_like_a_file("favicon.ico"));
        assert!(!looks_like_a_file("settings"));
        assert!(!looks_like_a_file("conversations/cnv_1"));
        // A dot in a directory name is not a dot in the file name, so this is
        // still a place and still gets the shell.
        assert!(!looks_like_a_file("v1.2/settings"));
    }

    #[test]
    fn only_the_hashed_bundle_is_cached_forever() {
        assert!(is_build_stamped("assets/index-a1b2c3.js"));
        // The entry point is named the same in every build, so caching it is
        // how a device gets stranded on a build whose files are gone.
        assert!(!is_build_stamped("index.html"));
        assert!(!is_build_stamped("favicon.ico"));
    }
}
