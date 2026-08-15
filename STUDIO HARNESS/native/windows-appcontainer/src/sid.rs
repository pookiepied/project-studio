//! Security identifiers, and who is responsible for freeing them.
//!
//! Three Win32 functions in this binary hand back a `PSID`, and they do **not**
//! agree on how it is released: profile and derivation SIDs want `FreeSid`,
//! while anything produced by the string converters wants `LocalFree`. Getting
//! that pairing wrong is a heap corruption that appears as an unrelated crash
//! much later, so the pairing is expressed in the type rather than remembered
//! at each call site.

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSidToSidW,
};
use windows_sys::Win32::Security::{FreeSid, PSID};

use crate::wide::{from_wide_ptr, to_wide};

/// Which allocator handed us the SID, and therefore which one takes it back.
#[derive(Clone, Copy)]
enum Owner {
    /// `CreateAppContainerProfile`, `DeriveAppContainerSidFromAppContainerName`.
    Sid,
    /// `ConvertStringSidToSidW`.
    Local,
}

/// A `PSID` that frees itself with the matching allocator.
pub struct OwnedSid {
    raw: PSID,
    owner: Owner,
}

impl OwnedSid {
    /// # Safety
    /// `raw` must come from `CreateAppContainerProfile` or
    /// `DeriveAppContainerSidFromAppContainerName`.
    pub unsafe fn from_appcontainer(raw: PSID) -> Self {
        Self { raw, owner: Owner::Sid }
    }

    pub fn raw(&self) -> PSID {
        self.raw
    }

    /// Parses the `S-1-15-2-…` form the harness passes on the command line.
    pub fn parse(text: &str) -> Result<Self, String> {
        let wide = to_wide(text);
        let mut raw: PSID = std::ptr::null_mut();
        let ok = unsafe { ConvertStringSidToSidW(wide.as_ptr(), &mut raw) };
        if ok == 0 {
            return Err(format!("not a valid security identifier: {text}"));
        }
        Ok(Self { raw, owner: Owner::Local })
    }

    /// The printable form, which is the only shape that crosses back to Node.
    pub fn to_text(&self) -> Result<String, String> {
        let mut buffer: *mut u16 = std::ptr::null_mut();
        let ok = unsafe { ConvertSidToStringSidW(self.raw, &mut buffer) };
        if ok == 0 {
            return Err("could not format the security identifier".to_string());
        }
        let text = unsafe { from_wide_ptr(buffer) };
        unsafe { LocalFree(buffer as _) };
        Ok(text)
    }
}

impl Drop for OwnedSid {
    fn drop(&mut self) {
        if self.raw.is_null() {
            return;
        }
        match self.owner {
            Owner::Sid => unsafe { FreeSid(self.raw) },
            Owner::Local => unsafe { LocalFree(self.raw as _) },
        };
    }
}
