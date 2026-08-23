//! The end-to-end check: a real Harness, started the real way.
//!
//! Every other test in this module tree examines one piece in isolation --
//! which environment variables a `Command` carries, whether a readiness line
//! parses. None of them can fail if the bootstrap transport is wrong, because
//! none of them ever runs the Node entrypoint that reads it. This one does.
//!
//! It spawns `STUDIO HARNESS/dist/server.mjs` through the supervisor, which
//! means it exercises the whole chain in the order the app uses it: the
//! environment allowlist, the platform's bootstrap transport, the readiness
//! reader, and the admission credential the Harness only ever learns over a
//! pipe. The proof that the credential arrived is the last step -- an
//! authenticated request the Harness answers, and the same request without the
//! bearer that it refuses.
//!
//! Requires `dist/server.mjs`. `pnpm build` in `STUDIO HARNESS/` writes it.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use super::endpoint::HarnessEndpoint;
use super::supervisor::HarnessSupervisor;
use super::test_support::ONE_HARNESS_AT_A_TIME;

/// Long enough for a cold Node start plus the supervisor's own 30s budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Shuts the Harness down even when an assertion between start and stop panics.
///
/// Without this a failing assertion leaks a Node process holding a loopback
/// port for the rest of the machine's uptime, and the next run of this test
/// inherits the mess.
struct StopOnDrop(HarnessSupervisor);

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.shutdown_all();
    }
}

/// A one-shot HTTP/1.1 GET, written by hand.
///
/// `Connection: close` so the response ends at EOF and there is no chunked or
/// content-length parsing to get wrong. Returns the status code and the body.
fn get(endpoint: &HarnessEndpoint, path: &str, bearer: Option<&str>) -> (u16, String) {
    let address = format!("{}:{}", endpoint.host, endpoint.port)
        .to_socket_addrs()
        .expect("resolve loopback address")
        .next()
        .expect("at least one loopback address");

    let mut stream =
        TcpStream::connect_timeout(&address, REQUEST_TIMEOUT).expect("connect to the harness");
    stream.set_read_timeout(Some(REQUEST_TIMEOUT)).expect("read timeout");
    stream.set_write_timeout(Some(REQUEST_TIMEOUT)).expect("write timeout");

    let authorization = match bearer {
        Some(token) => format!("Authorization: Bearer {token}\r\n"),
        None => String::new(),
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}:{}\r\n{authorization}Connection: close\r\n\r\n",
        endpoint.host, endpoint.port
    );
    stream.write_all(request.as_bytes()).expect("write request");
    stream.flush().expect("flush request");

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).expect("read response");
    let response = String::from_utf8_lossy(&raw).into_owned();

    let status = response
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or_else(|| panic!("no status line in response: {response}"));
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default();

    (status, body)
}

#[test]
fn a_real_harness_starts_publishes_a_loopback_endpoint_and_answers_an_admitted_request() {
    let _serial = ONE_HARNESS_AT_A_TIME.lock().unwrap();
    let supervisor = HarnessSupervisor::new();
    let endpoint = match supervisor.start() {
        Ok(endpoint) => endpoint,
        Err(error) => panic!("the harness did not start: {error}"),
    };
    let _stop = StopOnDrop(supervisor.clone());

    // The readiness frame, as the supervisor understood it. Loopback and a
    // real port are the two things `from_readiness` refuses to accept without,
    // so asserting them here is asserting that a frame arrived at all rather
    // than that the supervisor invented one.
    assert_eq!(endpoint.host, "127.0.0.1", "the harness must bind loopback");
    assert_ne!(endpoint.port, 0, "the harness must publish its bound port");
    assert_ne!(endpoint.pid, 0, "the readiness frame must name the process");
    assert_eq!(endpoint.client_id, "studio-host");
    assert!(!endpoint.session_id.is_empty(), "the launch must have a session id");
    assert_eq!(endpoint.url, format!("http://127.0.0.1:{}", endpoint.port));

    // Visible under `--nocapture`, and never the token: `redact` guards every
    // diagnostic the supervisor writes, and this is the one place a test could
    // put the bearer on a terminal by hand.
    println!(
        "readiness: host={} port={} pid={} clientId={} sessionId={} token=[redacted {} chars]",
        endpoint.host,
        endpoint.port,
        endpoint.pid,
        endpoint.client_id,
        endpoint.session_id,
        endpoint.token.len()
    );

    // The credential reached the child. It was never in the environment and
    // never on the command line, so a 200 here is only possible if the
    // bootstrap pipe delivered it -- which is the whole reason the channel
    // exists, and the thing no unit test in this module can observe.
    let (status, body) = get(&endpoint, "/api/mcp/servers", Some(&endpoint.token));
    assert_eq!(status, 200, "admitted request was refused: {body}");
    assert!(
        body.trim_start().starts_with('['),
        "expected a JSON list of MCP servers, got: {body}"
    );

    // And the bearer is doing work rather than being ignored. Without this the
    // assertion above would pass just as well against a Harness that admits
    // everyone.
    let (unauthenticated, _) = get(&endpoint, "/api/mcp/servers", None);
    assert_eq!(unauthenticated, 401, "the harness admitted an unauthenticated request");

    // Reported as running while it is up, and not once it is stopped.
    assert_eq!(supervisor.status().state, "running");
    supervisor.shutdown_all();
    assert!(
        supervisor.get_endpoint().is_none(),
        "the endpoint outlived the process it describes"
    );
}
