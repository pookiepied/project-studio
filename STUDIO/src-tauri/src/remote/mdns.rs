//! The name the home network can type: `studio.local`, published over mDNS.
//!
//! Typing `192.168.1.47:4747` is developer behaviour, and this is not a
//! developer tool (ADR 0050 §3.6). The QR code is the normal path and the raw
//! address is the fallback; this name is the memorable one for the second
//! visit and after, published by Studio itself while the feature is on and
//! withdrawn when it is off. The plan made it the last step for a stated
//! reason: everything works without it, and it is the piece most likely to
//! behave differently across networks — so it rides on a feature that is
//! already true, and never delays or breaks one.
//!
//! What is published: the conventional `_http._tcp` service, whose host name
//! is `studio.local.` and whose port is the listener's. The A record is the
//! point — it is what a browser resolves when a person types the name — and
//! the service record is the vehicle mdns-sd publishes a name through, which
//! also makes Studio show up in a service browse as a web service.
//!
//! ---- Which addresses -----------------------------------------------------
//!
//! mDNS is link-local multicast. It reaches only the network the machine is
//! attached to, and it does not travel over Tailscale at all — the
//! away-from-home name is Tailscale's own (§3.6), not this one. So the
//! addresses worth advertising are the private ones (RFC 1918). That one rule
//! drops loopback, the 169.254 band, Tailscale's 100.64/10, and anything
//! public, and needs no knowledge of which adapter is which. What it cannot
//! drop is a virtual adapter carrying a private address (Hyper-V's default
//! switch does); its address is advertised too, and a browser that resolves
//! the name simply tries the answers and fails fast on the unreachable ones.
//! Every native app that publishes a `.local` name on a machine with
//! adapters beyond one NIC shares this shape.
//!
//! ---- What can fail -------------------------------------------------------
//!
//! Nothing here fails the feature. The switch turns the listener on; mDNS is
//! a convenience riding on it, and every failure — the daemon would not
//! start, the interfaces could not be read, the goodbye was not confirmed —
//! is a log line, with the feature still working by QR code and raw address.
//! Conversely, switching off withdraws the name and shuts the responder down:
//! while the feature is off nothing of it is running, the same rule the
//! listener itself follows (§3.8 — not bound-and-refusing, not created).
//!
//! Two honest limits. Addresses are read when the switch turns on, so a
//! machine that changes networks while the feature is on advertises its old
//! answer until the record's TTL ages it out (mdns-sd's host TTL, two
//! minutes). And the records are IPv4 only: the URL a person types is the
//! IPv4 path, and the IPv6 addresses a home machine has are link-local ones
//! whose scope a browser on another device does not carry.

use std::net::Ipv4Addr;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceInfo};

/// How long a withdrawal waits for its goodbye to be confirmed.
///
/// The caller is `stop`, which is synchronous and runs on the way out of a
/// command or the app; the goodbye has almost always left the machine even
/// when the confirmation is missed, so the wait is bounded and the miss is a
/// log line, not a failure.
const WITHDRAW_WAIT: Duration = Duration::from_millis(300);

/// The service type the conventional web service is published under.
const SERVICE_TYPE: &str = "_http._tcp.local.";

/// The name a service browse shows.
const SERVICE_INSTANCE: &str = "Studio";

/// The name a person types. This record is the reason the module exists.
const HOST_NAME: &str = "studio.local.";

/// The responder, as Studio talks to it.
///
/// A seam rather than an abstraction for its own sake: the real one wraps
/// mdns-sd's daemon thread, and the tests hand a stub, because a unit test
/// that registered a real service would speak multicast on the developer's
/// network — and a suite whose behaviour depends on the room it runs in is
/// exactly what "behaves differently across networks" warns about.
trait Responder {
    /// Announces the service. Answers for its records go out until withdrawn.
    fn register(&self, service: ServiceInfo) -> Result<(), String>;

    /// Says goodbye for `fullname`, so cached answers expire now rather than
    /// at their TTL.
    fn unregister(&self, fullname: &str) -> Result<(), String>;

    /// Ends the responder. After this nothing of it is running.
    fn shutdown(&self);
}

/// The real responder: one mdns-sd daemon thread.
struct LiveResponder {
    daemon: ServiceDaemon,
}

impl Responder for LiveResponder {
    fn register(&self, service: ServiceInfo) -> Result<(), String> {
        self.daemon
            .register(service)
            .map_err(|error| format!("the responder refused the registration: {error}"))
    }

    fn unregister(&self, fullname: &str) -> Result<(), String> {
        self.daemon
            .unregister(fullname)
            .map_err(|error| format!("the responder refused the withdrawal: {error}"))?
            .recv_timeout(WITHDRAW_WAIT)
            .map(|_| ())
            .map_err(|error| format!("the withdrawal was not confirmed in time: {error}"))
    }

    fn shutdown(&self) {
        // The responder is ending anyway; nobody is waiting on its status.
        let _ = self.daemon.shutdown();
    }
}

/// The published name, as Studio holds it.
///
/// One at a time. Publishing again — the port, or the address list, changed
/// under an open feature — re-announces through the same responder rather
/// than stacking a second one, which is also what mdns-sd asks for: register
/// again, no withdrawal needed. Withdrawing clears both halves together and
/// leaves nothing behind.
#[derive(Default)]
pub(super) struct Mdns {
    responder: Option<Box<dyn Responder + Send>>,
    /// The fullname currently announced, so the goodbye names exactly what
    /// was published. Absent means nothing is.
    published: Option<String>,
}

impl Mdns {
    /// Publishes `studio.local` for the listener's `port`, resolving to
    /// `addresses`.
    ///
    /// Never fails its caller: every outcome that is not a published name is
    /// a log line, because the raw address and the QR code answer without
    /// this one. An empty address list is not an error but the honest state
    /// "there is nothing worth advertising" — and it withdraws anything
    /// already published, so a machine that lost its home network while the
    /// feature was on stops answering for the name rather than answering
    /// with a stale address.
    pub(super) fn publish(&mut self, port: u16, addresses: &[Ipv4Addr]) {
        if addresses.is_empty() {
            log::info!(
                "Remote access: no home-network address to publish studio.local for; \
                 the raw address still works."
            );
            self.withdraw();
            return;
        }

        let service = match studio_service(port, addresses) {
            Ok(service) => service,
            Err(error) => {
                log::warn!("Remote access: {error}");
                return;
            }
        };
        let fullname = service.get_fullname().to_owned();

        if self.responder.is_none() {
            match live_responder() {
                Ok(live) => self.responder = Some(live),
                Err(error) => {
                    log::warn!("Remote access: {error}");
                    return;
                }
            }
        }
        let Some(responder) = self.responder.as_ref() else {
            return;
        };
        if let Err(error) = responder.register(service) {
            log::warn!("Remote access: studio.local could not be published: {error}");
            return;
        }

        log::info!(
            "Remote access: studio.local is published for {addresses:?} on port {port}."
        );
        self.published = Some(fullname);
    }

    /// Withdraws the name and ends the responder. Idempotent.
    ///
    /// The goodbye matters more than a failed stop does: a withdrawn name is
    /// the difference between a device's cached answer expiring now and
    /// expiring at its TTL. Still, a goodbye that did not go out is a log
    /// line — the name ages out on its own.
    pub(super) fn withdraw(&mut self) {
        let Some(fullname) = self.published.take() else {
            return;
        };
        let Some(responder) = self.responder.take() else {
            return;
        };
        match responder.unregister(&fullname) {
            Ok(()) => log::info!("Remote access: studio.local withdrawn."),
            Err(error) => {
                log::warn!("Remote access: studio.local could not be withdrawn cleanly: {error}")
            }
        }
        responder.shutdown();
    }
}

/// The real responder, or the sentence saying why there is not one.
fn live_responder() -> Result<Box<dyn Responder + Send>, String> {
    let daemon = ServiceDaemon::new()
        .map_err(|error| format!("the mDNS responder could not start: {error}"))?;
    Ok(Box::new(LiveResponder { daemon }))
}

/// The service record Studio publishes, built in one place so its shape is
/// pinned once: the conventional web service, whose host name is the name a
/// person types and whose port is the listener's.
fn studio_service(port: u16, addresses: &[Ipv4Addr]) -> Result<ServiceInfo, String> {
    // mdns-sd's address argument speaks `IpAddr`; the home rule has already
    // narrowed what arrives here to IPv4.
    let addresses: Vec<std::net::IpAddr> = addresses
        .iter()
        .map(|address| std::net::IpAddr::V4(*address))
        .collect();
    ServiceInfo::new(
        SERVICE_TYPE,
        SERVICE_INSTANCE,
        HOST_NAME,
        addresses.as_slice(),
        port,
        // No TXT properties: the record's answers are the name, the port and
        // the addresses, and nothing else has anyone to talk to.
        &[] as &[(&str, &str)],
    )
    .map_err(|error| format!("the studio.local record would not build: {error}"))
}

/// The machine's addresses worth advertising, read now.
///
/// IPv4 only (the module note says why), then the home rule.
pub(super) fn home_addresses() -> Vec<Ipv4Addr> {
    match if_addrs::get_if_addrs() {
        Ok(interfaces) => home_addresses_of(interfaces.iter().filter_map(|interface| {
            match interface.ip() {
                std::net::IpAddr::V4(address) => Some(address),
                std::net::IpAddr::V6(_) => None,
            }
        })),
        Err(error) => {
            log::warn!("Remote access: could not read this machine's interfaces: {error}");
            Vec::new()
        }
    }
}

/// The home rule, applied: the private addresses, deduplicated and sorted,
/// so what is announced does not depend on the order the OS enumerated the
/// interfaces in.
fn home_addresses_of<I>(addresses: I) -> Vec<Ipv4Addr>
where
    I: IntoIterator<Item = Ipv4Addr>,
{
    let mut kept: Vec<Ipv4Addr> = addresses
        .into_iter()
        .filter(|address| is_home_address(*address))
        .collect();
    kept.sort();
    kept.dedup();
    kept
}

/// One address, against the home rule: the private ranges are the home
/// network mDNS reaches, and everything else — loopback, the 169.254 band,
/// Tailscale's 100.64/10, anything public — is not a place this name can
/// honestly answer for.
fn is_home_address(address: Ipv4Addr) -> bool {
    matches!(
        address.octets(),
        [10, ..] | [172, 16..=31, ..] | [192, 168, ..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn address(octets: [u8; 4]) -> Ipv4Addr {
        octets.into()
    }

    #[test]
    fn the_home_rule_keeps_exactly_the_private_ranges() {
        // The ranges a home network uses, kept.
        assert!(is_home_address(address([10, 0, 0, 1])));
        assert!(is_home_address(address([172, 16, 0, 1])));
        assert!(is_home_address(address([172, 31, 255, 254])));
        assert!(is_home_address(address([192, 168, 1, 47])));

        // The edges of the 172.16/12 block: 172.15 and 172.32 sit outside it.
        assert!(!is_home_address(address([172, 15, 255, 255])));
        assert!(!is_home_address(address([172, 32, 0, 0])));

        // Loopback, the link-local band, Tailscale's CGNAT band, and a public
        // address: dropped, each for the reason the module note gives.
        assert!(!is_home_address(address([127, 0, 0, 1])));
        assert!(!is_home_address(address([169, 254, 3, 7])));
        assert!(!is_home_address(address([100, 64, 0, 1])));
        assert!(!is_home_address(address([100, 127, 255, 254])));
        assert!(!is_home_address(address([203, 0, 113, 9])));
    }

    #[test]
    fn the_advertised_list_is_the_rule_deduplicated_and_sorted() {
        let kept = home_addresses_of([
            address([192, 168, 1, 47]),
            address([10, 0, 0, 5]),
            // Tailscale's address, which mDNS does not travel over: dropped.
            address([100, 64, 0, 1]),
            // The same adapter seen twice through two enumerations: once.
            address([192, 168, 1, 47]),
        ]);
        assert_eq!(
            kept,
            vec![address([10, 0, 0, 5]), address([192, 168, 1, 47])]
        );
    }

    #[test]
    fn the_record_names_what_a_person_types_at_the_listeners_port() {
        let service = studio_service(4747, &[address([192, 168, 1, 47])]).unwrap();

        assert_eq!(service.get_fullname(), "Studio._http._tcp.local.");
        assert_eq!(service.get_hostname(), "studio.local.");
        assert_eq!(service.get_port(), 4747);
        assert!(service.get_addresses_v4().contains(&address([192, 168, 1, 47])));
    }

    /// What the tests hand in place of a daemon: it counts what it was asked,
    /// and never speaks multicast on the network the test runs in.
    #[derive(Default)]
    struct Record {
        registered: Vec<String>,
        withdrawn: Vec<String>,
        shut_down: bool,
    }

    struct StubResponder {
        record: Arc<Mutex<Record>>,
    }

    impl Responder for StubResponder {
        fn register(&self, service: ServiceInfo) -> Result<(), String> {
            self.record
                .lock()
                .unwrap()
                .registered
                .push(service.get_fullname().to_owned());
            Ok(())
        }

        fn unregister(&self, fullname: &str) -> Result<(), String> {
            self.record
                .lock()
                .unwrap()
                .withdrawn
                .push(fullname.to_owned());
            Ok(())
        }

        fn shutdown(&self) {
            self.record.lock().unwrap().shut_down = true;
        }
    }

    fn mdns_on(record: Arc<Mutex<Record>>) -> Mdns {
        Mdns {
            responder: Some(Box::new(StubResponder { record })),
            published: None,
        }
    }

    #[test]
    fn publishing_registers_the_name_and_withdrawing_goodbyes_it() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut mdns = mdns_on(record.clone());

        mdns.publish(4747, &[address([192, 168, 1, 47])]);
        assert_eq!(
            record.lock().unwrap().registered,
            vec!["Studio._http._tcp.local.".to_owned()]
        );

        mdns.withdraw();
        let record = record.lock().unwrap();
        assert_eq!(
            record.withdrawn,
            vec!["Studio._http._tcp.local.".to_owned()],
            "the goodbye names exactly what was published"
        );
        assert!(record.shut_down, "nothing of the responder outlives it");
    }

    #[test]
    fn withdrawing_twice_goodbyes_once() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut mdns = mdns_on(record.clone());

        mdns.publish(4747, &[address([192, 168, 1, 47])]);
        mdns.withdraw();
        // Stopping a listener twice, or stopping one that never ran, is not
        // an error and not a second goodbye.
        mdns.withdraw();

        assert_eq!(record.lock().unwrap().withdrawn.len(), 1);
    }

    #[test]
    fn republishing_reannounces_through_the_same_responder_without_a_goodbye() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut mdns = mdns_on(record.clone());

        mdns.publish(4747, &[address([192, 168, 1, 47])]);
        mdns.publish(4747, &[address([10, 0, 0, 5])]);

        let record = record.lock().unwrap();
        assert_eq!(record.registered.len(), 2);
        assert!(record.withdrawn.is_empty());
        assert!(!record.shut_down);
    }

    #[test]
    fn publishing_with_no_addresses_withdraws_instead() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut mdns = mdns_on(record.clone());
        mdns.publish(4747, &[address([192, 168, 1, 47])]);

        // The machine lost its home network while the feature was on. A name
        // that keeps answering with the stale address is a name that lies;
        // "nothing to advertise" is the honest state, and it says so.
        mdns.publish(4747, &[]);

        let record = record.lock().unwrap();
        assert_eq!(record.registered.len(), 1);
        assert_eq!(record.withdrawn.len(), 1);
        assert!(record.shut_down);
    }

    #[test]
    fn nothing_was_ever_published_withdraws_as_nothing() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut mdns = mdns_on(record.clone());

        mdns.withdraw();

        let record = record.lock().unwrap();
        assert!(record.withdrawn.is_empty());
        assert!(!record.shut_down);
    }
}
