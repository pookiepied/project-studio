//! Capabilities: the named holes deliberately left in a container's wall.
//!
//! An AppContainer with no capabilities can reach nothing outside the files it
//! was granted — not the network, not the loopback interface, not the machines
//! on the user's LAN. That is the default here and it is the right default.
//!
//! A capability opens exactly one of those, by name, and the names are not
//! interchangeable. `internetClient` is **outbound to the internet only**;
//! reaching `127.0.0.1`, `192.168.x.x` or anything else on the local network is
//! a *different* capability (`privateNetworkClientServer`), and accepting
//! inbound connections is a third (`internetClientServer`). That separation is
//! the whole reason a network-using MCP server can be contained usefully rather
//! than either fully trusted or unusable.
//!
//! Whether Windows honours that separation as documented is not taken on faith
//! — `probe --connect` measures it.

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::{
    DeriveCapabilitySidsFromName, PSID, SID_AND_ATTRIBUTES,
};

use crate::sid::OwnedSid;
use crate::wide::to_wide;

/// `SE_GROUP_ENABLED` — a capability present but not enabled grants nothing.
const ENABLED: u32 = 0x0000_0004;

/// The capability SIDs for a set of names, ready for `SECURITY_CAPABILITIES`.
///
/// The SIDs must outlive `CreateProcessW`, so they are held here and this value
/// is kept alive by the caller for the duration of the spawn.
pub struct Capabilities {
    entries: Vec<SID_AND_ATTRIBUTES>,
}

impl Capabilities {
    pub fn derive(names: &[String]) -> Result<Self, String> {
        let mut entries = Vec::new();

        for name in names {
            // A capability may be named, or it may only exist as a SID on some
            // object's ACL — `C:\` carries one that no documented name derives
            // to. Accepting both is the difference between "we can ask for what
            // Windows already grants here" and "we cannot express it at all".
            if name.starts_with("S-1-15-3-") {
                let sid = OwnedSid::parse(name)?;
                entries.push(SID_AND_ATTRIBUTES { Sid: sid.raw(), Attributes: ENABLED });
                // Held for the process's life, like the derived ones below.
                std::mem::forget(sid);
                continue;
            }

            let wide = to_wide(name);
            let mut group_sids: *mut PSID = std::ptr::null_mut();
            let mut group_count: u32 = 0;
            let mut sids: *mut PSID = std::ptr::null_mut();
            let mut count: u32 = 0;

            let ok = unsafe {
                DeriveCapabilitySidsFromName(
                    wide.as_ptr(),
                    &mut group_sids,
                    &mut group_count,
                    &mut sids,
                    &mut count,
                )
            };
            if ok == 0 || count == 0 {
                return Err(format!("unknown capability: {name}"));
            }

            for index in 0..count as usize {
                // Each SID is kept, deliberately unfreed: it has to stay valid
                // until the child is created, and this process exits shortly
                // after that. Freeing the array while keeping pointers into it
                // is the version of "tidy" that corrupts a security descriptor.
                entries.push(SID_AND_ATTRIBUTES {
                    Sid: unsafe { *sids.add(index) },
                    Attributes: ENABLED,
                });
            }

            // The *arrays* are ours to release; the SIDs they held are not.
            unsafe { LocalFree(sids as _) };
            if !group_sids.is_null() {
                for index in 0..group_count as usize {
                    unsafe { LocalFree(*group_sids.add(index) as _) };
                }
                unsafe { LocalFree(group_sids as _) };
            }
        }

        Ok(Self { entries })
    }

    pub fn count(&self) -> u32 {
        self.entries.len() as u32
    }

    /// Null when empty, which is what `SECURITY_CAPABILITIES` expects — and
    /// what every container gets unless a capability was asked for by name.
    pub fn pointer(&mut self) -> *mut SID_AND_ATTRIBUTES {
        if self.entries.is_empty() {
            std::ptr::null_mut()
        } else {
            self.entries.as_mut_ptr()
        }
    }
}
