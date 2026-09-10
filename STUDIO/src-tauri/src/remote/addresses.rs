//! The addresses a device can reach Studio at, told honestly.
//!
//! ADR 0050 §3.6 asks for a name rather than an IP, and then admits the one
//! thing that makes a single name a lie: mDNS is link-local multicast and
//! does not travel over Tailscale. So `studio.local` is the name *at home*,
//! the Tailscale name is the one *away*, and the settings screen has to show
//! both and say which is which rather than imply one address works
//! everywhere. This module is the reading that screen renders: every
//! home-network address, whether the name is published for them, and the
//! Tailscale address when the machine has one.
//!
//! Nothing here is cached. The screen asks when it opens and again on a slow
//! poll, and a machine that joined a network or started Tailscale in between
//! should be told the truth at the next reading, not at the next launch.

use std::net::Ipv4Addr;
use std::time::Duration;

use serde::Serialize;

use super::mdns;

/// What a device can type or scan, for one reading of the machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Addresses {
    /// The port every address below is served on.
    pub(crate) port: u16,
    /// The private-range addresses of this machine: the ones a phone on the
    /// same network can reach. Sorted and deduplicated, the same list the
    /// name is published for.
    pub(crate) home: Vec<String>,
    /// `studio.local`, when it is currently published. Absent when it is not:
    /// a name shown for a machine that is not answering to it would send
    /// someone to a page that never loads.
    pub(crate) home_name: Option<String>,
    /// The address that works away from home, when Tailscale is on this
    /// machine.
    pub(crate) away: Option<Away>,
}

/// The Tailscale side of the reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Away {
    /// The machine's address on the tailnet (`100.64.0.0/10`).
    pub(crate) address: String,
    /// The MagicDNS name, when Tailscale's own tool would say it. Absent
    /// means the address is the only thing to show; it still works.
    pub(crate) name: Option<String>,
}

/// One reading of the machine.
///
/// `home_name_published` is the listener's own knowledge of whether the
/// name is out, passed in rather than asked for, so this module never holds
/// the publisher's lock. The Tailscale name is asked of the `tailscale`
/// tool with a short deadline: a machine without it answers "no such
/// program" at once, and one where the tool hangs must not hang the screen.
pub(crate) async fn read(port: u16, home_name_published: bool) -> Addresses {
    let (home, tailscale) = interfaces();
    let away = match tailscale {
        Some(address) => Some(Away {
            address: address.to_string(),
            name: magic_dns_name().await,
        }),
        None => None,
    };
    Addresses {
        port,
        home: home.iter().map(ToString::to_string).collect(),
        home_name: home_name_published.then(|| mdns::HOME_NAME.to_owned()),
        away,
    }
}

/// The home addresses, and the Tailscale one if there is one.
fn interfaces() -> (Vec<Ipv4Addr>, Option<Ipv4Addr>) {
    let addresses: Vec<Ipv4Addr> = match if_addrs::get_if_addrs() {
        Ok(interfaces) => interfaces
            .iter()
            .filter_map(|interface| match interface.ip() {
                std::net::IpAddr::V4(address) => Some(address),
                std::net::IpAddr::V6(_) => None,
            })
            .collect(),
        Err(error) => {
            log::warn!("Remote access: could not read this machine's interfaces: {error}");
            Vec::new()
        }
    };
    split(addresses)
}

/// The home rule and the Tailscale rule, applied to one list.
///
/// Home is what `mdns.rs` publishes for, by its own rule, so the addresses
/// the screen prints are exactly the ones the name resolves to. Tailscale is
/// the carrier-grade NAT range the tailnet hands out; the first one wins,
/// because a machine has one tailnet address and a second would be a
/// misconfiguration this screen cannot explain.
fn split(addresses: Vec<Ipv4Addr>) -> (Vec<Ipv4Addr>, Option<Ipv4Addr>) {
    let tailscale = addresses
        .iter()
        .copied()
        .find(|address| is_tailscale_address(*address));
    (mdns::home_addresses_of(addresses), tailscale)
}

/// `100.64.0.0/10`: the range Tailscale assigns from.
fn is_tailscale_address(address: Ipv4Addr) -> bool {
    matches!(address.octets(), [100, 64..=127, ..])
}

/// How long the `tailscale` tool is given to say the machine's name.
const TAILSCALE_DEADLINE: Duration = Duration::from_secs(2);

/// The MagicDNS name, from `tailscale status --json`, or nothing.
///
/// Every failure is nothing rather than an error: the tool not being
/// installed, not being on the path, timing out, or answering something
/// that is not the shape expected. The address still works without the
/// name, so the name is a nicety the screen can go without.
async fn magic_dns_name() -> Option<String> {
    let mut command = tokio::process::Command::new("tailscale");
    command.args(["status", "--json"]);
    command.stdin(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        // No console window flashing up behind Studio for a status read.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = tokio::time::timeout(TAILSCALE_DEADLINE, command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    name_from_status(&text)
}

/// `Self.DNSName` out of the tool's JSON, without the trailing dot the tool
/// writes and a browser would not want.
fn name_from_status(text: &str) -> Option<String> {
    let document: serde_json::Value = serde_json::from_str(text).ok()?;
    let name = document.get("Self")?.get("DNSName")?.as_str()?;
    let name = name.trim().trim_end_matches('.');
    (!name.is_empty()).then(|| name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(octets: [u8; 4]) -> Ipv4Addr {
        octets.into()
    }

    #[test]
    fn the_tailscale_rule_is_the_carrier_grade_range_and_nothing_else() {
        assert!(is_tailscale_address(address([100, 64, 0, 1])));
        assert!(is_tailscale_address(address([100, 100, 5, 5])));
        assert!(is_tailscale_address(address([100, 127, 255, 254])));

        // Neighbours on both sides of the range are ordinary addresses.
        assert!(!is_tailscale_address(address([100, 63, 255, 255])));
        assert!(!is_tailscale_address(address([100, 128, 0, 0])));
        // The home ranges are not the tailnet.
        assert!(!is_tailscale_address(address([192, 168, 1, 47])));
        assert!(!is_tailscale_address(address([10, 0, 0, 5])));
    }

    #[test]
    fn one_list_splits_into_home_and_away_without_a_third_bucket() {
        let (home, away) = split(vec![
            address([127, 0, 0, 1]),
            address([192, 168, 1, 47]),
            address([100, 101, 102, 103]),
            address([169, 254, 3, 4]),
            address([10, 0, 0, 5]),
        ]);

        // Home is the private ranges, sorted; loopback and link-local are
        // neither home nor away.
        assert_eq!(home, vec![address([10, 0, 0, 5]), address([192, 168, 1, 47])]);
        assert_eq!(away, Some(address([100, 101, 102, 103])));
    }

    #[test]
    fn a_machine_without_tailscale_has_no_away_address() {
        let (_, away) = split(vec![address([192, 168, 1, 47])]);
        assert_eq!(away, None);
    }

    #[test]
    fn the_magic_dns_name_loses_its_trailing_dot() {
        let text = r#"{"Version":"1.80.0","Self":{"DNSName":"desk.tail1234.ts.net.","HostName":"desk"}}"#;
        assert_eq!(name_from_status(text), Some("desk.tail1234.ts.net".to_owned()));
    }

    #[test]
    fn a_status_without_a_name_is_no_name_rather_than_a_failure() {
        assert_eq!(name_from_status(r#"{"Self":{"DNSName":""}}"#), None);
        assert_eq!(name_from_status(r#"{"Self":{}}"#), None);
        assert_eq!(name_from_status(r#"{}"#), None);
        assert_eq!(name_from_status("not json"), None);
    }
}
