//! The AppContainer profile: create, look up, delete.
//!
//! A profile is a named, machine-persistent registration that yields a stable
//! SID. It is not a sandbox by itself — it is the identity the sandbox is built
//! around, and the ACLs in `acl.rs` are what give that identity any reach at
//! all. A profile with no grants can read nothing of the user's.
//!
//! Creation needs no elevation, which is the entire reason this design survives
//! on Windows 11 Home. That was measured, not assumed — see
//! `documentation/work/stage-4b-plan.md` §2.

use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile,
    DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::PSID;

use crate::sid::OwnedSid;
use crate::wide::to_wide;

/// `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`.
///
/// Not an error here. Profiles outlive the process that made them, so a second
/// run of the same workspace lands on this path every time, and treating it as
/// a failure would mean containment worked exactly once.
const ALREADY_EXISTS: i32 = -2147024713; // 0x800700B7

/// Ensures a profile exists and returns its SID.
///
/// Idempotent by construction rather than by a "does it exist" check first:
/// asking and then creating is a race between two harnesses starting at once,
/// and the OS already answers both questions in one call.
pub fn ensure(name: &str, display: &str) -> Result<OwnedSid, String> {
    let wide_name = to_wide(name);
    let wide_display = to_wide(display);
    let mut raw: PSID = std::ptr::null_mut();

    let hr = unsafe {
        CreateAppContainerProfile(
            wide_name.as_ptr(),
            wide_display.as_ptr(),
            wide_display.as_ptr(),
            // No capabilities. This is the whole point: a capability is a
            // permission to reach *outside* the container — the network ones in
            // particular — and the sandbox exists to withhold exactly those.
            std::ptr::null(),
            0,
            &mut raw,
        )
    };

    if hr == ALREADY_EXISTS {
        return derive(name);
    }
    if hr < 0 {
        return Err(format!("could not create the sandbox profile (hr=0x{hr:08x})"));
    }
    Ok(unsafe { OwnedSid::from_appcontainer(raw) })
}

/// The SID of an existing profile, without creating one.
pub fn derive(name: &str) -> Result<OwnedSid, String> {
    let wide_name = to_wide(name);
    let mut raw: PSID = std::ptr::null_mut();
    let hr = unsafe { DeriveAppContainerSidFromAppContainerName(wide_name.as_ptr(), &mut raw) };
    if hr < 0 {
        return Err(format!("could not look up the sandbox profile (hr=0x{hr:08x})"));
    }
    Ok(unsafe { OwnedSid::from_appcontainer(raw) })
}

/// Removes a profile.
///
/// The ACEs granted to its SID are **not** removed with it — they are on the
/// user's directories, not on the profile — so callers revoke first. Deleting
/// in the other order leaves an orphaned SID in a security descriptor, which is
/// what turns a project folder's ACL into an ever-growing list of dead
/// identities.
pub fn delete(name: &str) -> Result<(), String> {
    let wide_name = to_wide(name);
    let hr = unsafe { DeleteAppContainerProfile(wide_name.as_ptr()) };
    if hr < 0 {
        return Err(format!("could not delete the sandbox profile (hr=0x{hr:08x})"));
    }
    Ok(())
}
