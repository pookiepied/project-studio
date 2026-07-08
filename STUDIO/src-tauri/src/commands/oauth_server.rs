use std::io::{Read, Write};
use std::net::TcpListener;

fn try_bind_port(start_port: u16) -> Result<TcpListener, String> {
    // Try the preferred port first
    let addr = format!("127.0.0.1:{}", start_port);
    if let Ok(listener) = TcpListener::bind(&addr) {
        return Ok(listener);
    }

    // If that fails, try a few ports above
    for port in start_port..start_port + 10 {
        let addr = format!("127.0.0.1:{}", port);
        if let Ok(listener) = TcpListener::bind(&addr) {
            println!("[OAuth] Using fallback port {}", port);
            return Ok(listener);
        }
    }

    Err("Could not bind to any port".to_string())
}

pub fn start_server(state: String) -> Result<String, String> {
    println!("[OAuth] Starting server thread...");
    println!("[OAuth] Expected state: {}", state);

    // Try to bind to port 8765, if that fails, try next available port
    let listener = try_bind_port(8765)?;

    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(8765);
    println!("[OAuth] Server bound to port {}", actual_port);
    println!("[OAuth] Listening for connections...");

    let start_time = std::time::Instant::now();

    for stream_result in listener.incoming() {
        if start_time.elapsed().as_secs() > 120 {
            println!("[OAuth] Timeout after 120 seconds");
            return Err("Timeout".to_string());
        }

        let mut stream = match stream_result {
            Ok(s) => {
                println!("[OAuth] Connection accepted from: {:?}", s.peer_addr());
                // Set read timeout to prevent hanging
                if let Err(e) = s.set_read_timeout(Some(std::time::Duration::from_secs(5))) {
                    println!("[OAuth] Failed to set read timeout: {}", e);
                }
                s
            }
            Err(e) => {
                println!("[OAuth] Accept error: {}", e);
                continue;
            }
        };

        println!("[OAuth] Reading request...");

        let mut buffer = [0u8; 4096];
        let n = match stream.read(&mut buffer) {
            Ok(n) => {
                println!("[OAuth] Read {} bytes", n);
                n
            }
            Err(e) => {
                println!("[OAuth] Read error: {}", e);
                continue;
            }
        };

        if n == 0 {
            println!("[OAuth] Empty read, skipping");
            continue;
        }

        let request = String::from_utf8_lossy(&buffer[..n]);
        let first_line = request.lines().next().unwrap_or("");
        println!("[OAuth] Request: {}", first_line);

        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 {
            println!("[OAuth] Invalid request format");
            continue;
        }

        let path = parts[1];
        println!("[OAuth] Path: {}", path);

        // Code flow — Google puts `code` in query params (not fragment).
        // `code` may appear after other params so check for both `?code=` and `&code=`.
        // Handle this before the implicit-flow HTML page logic.
        if path.starts_with("/oauth/callback") && (path.contains("?code=") || path.contains("&code=")) {
            println!("[OAuth] Code flow callback detected");

            let query = path.split('?').nth(1).unwrap_or("");
            let query = query.split(' ').next().unwrap_or(query);

            let params: std::collections::HashMap<String, String> = query
                .split('&')
                .filter_map(|pair| {
                    let mut kv = pair.splitn(2, '=');
                    let k = kv.next()?.to_string();
                    let v = urlencoding::decode(kv.next().unwrap_or(""))
                        .unwrap_or_default()
                        .to_string();
                    Some((k, v))
                })
                .collect();

            let received_state = params.get("state").map(|s| s.as_str()).unwrap_or("");
            let code = params.get("code").map(|s| s.as_str()).unwrap_or("");

            println!("[OAuth] Code flow — state match: {}, has code: {}", received_state == state, !code.is_empty());

            let result = if received_state != state {
                serde_json::json!({"error": "State mismatch"}).to_string()
            } else if !code.is_empty() {
                serde_json::json!({"code": code}).to_string()
            } else {
                serde_json::json!({"error": "No authorization code received"}).to_string()
            };

            let html_body = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STUDIO</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{display:flex;flex-direction:column;align-items:center;gap:28px;opacity:0;transform:translateY(12px);animation:rise .55s cubic-bezier(.4,0,.2,1) .05s forwards}
@keyframes rise{to{opacity:1;transform:translateY(0)}}
.wordmark{font-size:10px;font-weight:500;letter-spacing:.38em;color:#111;text-transform:uppercase}
.icon{width:46px;height:46px;background:#f5f5f5;border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(.8);animation:pop .4s cubic-bezier(.34,1.56,.64,1) .22s forwards}
@keyframes pop{to{opacity:1;transform:scale(1)}}
.chk{stroke:#111;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;fill:none;stroke-dasharray:22;stroke-dashoffset:22;animation:draw .38s cubic-bezier(.4,0,.2,1) .52s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.copy{display:flex;flex-direction:column;align-items:center;gap:5px;opacity:0;animation:rise .45s cubic-bezier(.4,0,.2,1) .32s forwards}
.title{font-size:14px;font-weight:400;color:#111;letter-spacing:-.01em}
.sub{font-size:11.5px;font-weight:300;color:#bbb;letter-spacing:.01em}
</style>
</head>
<body>
<div class="wrap">
  <span class="wordmark">Studio</span>
  <div class="icon">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path class="chk" d="M3.5 9.5l3.5 3.5 7.5-8"/>
    </svg>
  </div>
  <div class="copy">
    <p class="title">Google account connected.</p>
    <p class="sub">You can close this window.</p>
  </div>
</div>
<script>setTimeout(function(){window.close()},3000)</script>
</body>
</html>"#;

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-cache, no-store, must-revalidate\r\n\r\n{}",
                html_body.len(),
                html_body
            );

            if let Err(e) = stream.write_all(response.as_bytes()) {
                println!("[OAuth] Write error: {}", e);
            }
            if let Err(e) = stream.flush() {
                println!("[OAuth] Flush error: {}", e);
            }
            drop(stream);

            println!("[OAuth] Code flow returning result: {}", result);
            return Ok(result);
        }

        // First request - serve HTML page
        if path.starts_with("/oauth/callback") && !path.contains("?fragment=") {
            println!("[OAuth] Serving HTML page");

            let html_body = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STUDIO</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{display:flex;flex-direction:column;align-items:center;gap:28px;opacity:0;transform:translateY(12px);animation:rise .55s cubic-bezier(.4,0,.2,1) .05s forwards}
@keyframes rise{to{opacity:1;transform:translateY(0)}}
.wordmark{font-size:10px;font-weight:500;letter-spacing:.38em;color:#111;text-transform:uppercase}
.dots{display:flex;gap:6px;align-items:center;height:46px}
.dot{width:5px;height:5px;background:#ddd;border-radius:50%;animation:pulse 1.2s cubic-bezier(.4,0,.6,1) infinite}
.dot:nth-child(1){animation-delay:0s}
.dot:nth-child(2){animation-delay:.18s}
.dot:nth-child(3){animation-delay:.36s}
@keyframes pulse{0%,100%{background:#ddd;transform:scale(1)}50%{background:#aaa;transform:scale(1.25)}}
.copy{display:flex;flex-direction:column;align-items:center;gap:5px;opacity:0;animation:rise .45s cubic-bezier(.4,0,.2,1) .32s forwards}
.title{font-size:14px;font-weight:400;color:#111;letter-spacing:-.01em}
.sub{font-size:11.5px;font-weight:300;color:#bbb;letter-spacing:.01em}
</style>
</head>
<body>
<div class="wrap">
  <span class="wordmark">Studio</span>
  <div class="dots">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
  <div class="copy">
    <p class="title">Authorizing&hellip;</p>
    <p class="sub" id="status">One moment.</p>
  </div>
</div>
<script>
(function(){
var status=document.getElementById('status');
try{
var hash=window.location.hash.substring(1);
if(hash&&hash.length>0){
window.location.href='/oauth/callback?fragment='+encodeURIComponent(hash);
}else{
status.textContent='No authentication data received.';
setTimeout(function(){window.close();},3000);
}
}catch(e){
status.textContent='Something went wrong.';
}
})();
</script>
</body>
</html>"#;

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-cache, no-store, must-revalidate\r\n\r\n{}",
                html_body.len(),
                html_body
            );

            println!(
                "[OAuth] Writing response ({} bytes total, {} body)",
                response.len(),
                html_body.len()
            );
            if let Err(e) = stream.write_all(response.as_bytes()) {
                println!("[OAuth] Write error: {}", e);
            } else {
                println!("[OAuth] Write successful");
            }

            if let Err(e) = stream.flush() {
                println!("[OAuth] Flush error: {}", e);
            } else {
                println!("[OAuth] Flush successful");
            }

            // Explicitly drop/close the stream
            drop(stream);

            println!("[OAuth] HTML page sent, connection closed, waiting for next request");
            continue;
        }

        // Second request - parse token
        if path.contains("?fragment=") {
            println!("[OAuth] Parsing token from fragment");

            let query = path.split("?fragment=").nth(1).unwrap_or("");
            let query = query.split(" ").next().unwrap_or(query);
            let fragment = urlencoding::decode(query).unwrap_or_default();

            println!("[OAuth] Fragment: {}", fragment);

            let params: std::collections::HashMap<String, String> = fragment
                .split('&')
                .filter_map(|pair| {
                    let mut parts = pair.split('=');
                    Some((parts.next()?.to_string(), parts.next()?.to_string()))
                })
                .collect();

            println!("[OAuth] Parsed {} parameters", params.len());

            let received_state = params.get("state").map(|s| s.as_str()).unwrap_or("");
            let id_token = params.get("id_token").map(|s| s.as_str()).unwrap_or("");

            println!("[OAuth] State match: {}", received_state == state);
            println!("[OAuth] Has token: {}", !id_token.is_empty());

            let result = if received_state != state {
                println!("[OAuth] State mismatch!");
                serde_json::json!({"error": "State mismatch"}).to_string()
            } else if !id_token.is_empty() {
                println!("[OAuth] Success! Returning token");
                serde_json::json!({"id_token": id_token}).to_string()
            } else {
                println!("[OAuth] No token found");
                serde_json::json!({"error": "No token"}).to_string()
            };

            let html_body = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STUDIO</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{display:flex;flex-direction:column;align-items:center;gap:28px;opacity:0;transform:translateY(12px);animation:rise .55s cubic-bezier(.4,0,.2,1) .05s forwards}
@keyframes rise{to{opacity:1;transform:translateY(0)}}
.wordmark{font-size:10px;font-weight:500;letter-spacing:.38em;color:#111;text-transform:uppercase}
.icon{width:46px;height:46px;background:#f5f5f5;border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(.8);animation:pop .4s cubic-bezier(.34,1.56,.64,1) .22s forwards}
@keyframes pop{to{opacity:1;transform:scale(1)}}
.chk{stroke:#111;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;fill:none;stroke-dasharray:22;stroke-dashoffset:22;animation:draw .38s cubic-bezier(.4,0,.2,1) .52s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.copy{display:flex;flex-direction:column;align-items:center;gap:5px;opacity:0;animation:rise .45s cubic-bezier(.4,0,.2,1) .32s forwards}
.title{font-size:14px;font-weight:400;color:#111;letter-spacing:-.01em}
.sub{font-size:11.5px;font-weight:300;color:#bbb;letter-spacing:.01em}
</style>
</head>
<body>
<div class="wrap">
  <span class="wordmark">Studio</span>
  <div class="icon">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path class="chk" d="M3.5 9.5l3.5 3.5 7.5-8"/>
    </svg>
  </div>
  <div class="copy">
    <p class="title">Signed in.</p>
    <p class="sub">You can close this window.</p>
  </div>
</div>
<script>setTimeout(function(){window.close()},3000)</script>
</body>
</html>"#;

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-cache, no-store, must-revalidate\r\n\r\n{}",
                html_body.len(),
                html_body
            );

            println!("[OAuth] Sending success page");
            if let Err(e) = stream.write_all(response.as_bytes()) {
                println!("[OAuth] Write error: {}", e);
            }
            if let Err(e) = stream.flush() {
                println!("[OAuth] Flush error: {}", e);
            }

            // Explicitly close the stream
            drop(stream);

            println!("[OAuth] Returning result: {}", result);
            return Ok(result);
        }

        println!("[OAuth] Unhandled path: {}", path);
    }

    println!("[OAuth] Server loop ended");
    Err("Server stopped".to_string())
}
