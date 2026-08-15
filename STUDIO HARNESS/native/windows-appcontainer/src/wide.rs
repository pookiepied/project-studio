//! UTF-16 conversion, in one place.
//!
//! Every Win32 call this binary makes is the `W` variant, so every string
//! crosses this boundary. Doing it inline at each call site is how a missing
//! NUL terminator gets shipped once and then copied.

use std::ffi::OsStr;
use std::os::windows::ffi::{OsStrExt, OsStringExt};

/// A NUL-terminated UTF-16 buffer, kept alive by the caller.
///
/// Returning the `Vec` rather than a pointer is deliberate: a function that
/// returned `PCWSTR` would hand back a pointer into a temporary that Rust is
/// free to drop on the same line.
pub fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
}

/// Reads a NUL-terminated UTF-16 string the OS allocated for us.
///
/// # Safety
/// `ptr` must be a valid pointer to a NUL-terminated UTF-16 sequence.
pub unsafe fn from_wide_ptr(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut length = 0usize;
    while unsafe { *ptr.add(length) } != 0 {
        length += 1;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, length) };
    std::ffi::OsString::from_wide(slice).to_string_lossy().into_owned()
}
