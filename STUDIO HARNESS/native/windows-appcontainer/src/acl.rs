//! What a contained child may reach, expressed as explicit access masks.
//!
//! # Why not `icacls`
//!
//! The spike granted `(OI)(CI)(RX)` with `icacls` and got a child that could
//! read a file in the workspace but could **not** list the workspace. `RX` is a
//! shorthand, and a shorthand is exactly the wrong instrument for diagnosing a
//! rights problem: you cannot tell which bit is missing when you never named
//! the bits. Every mask below is written out of its components for that reason,
//! and enumeration is called out where it lives.
//!
//! Doing it in-process also removes a shell-out from a security-critical path.
//! `runProcess` refuses to spawn anything but `.exe` precisely so that argument
//! text is never reinterpreted; building an `icacls` command line to configure
//! the sandbox would put that guarantee back at risk for no gain.

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SE_FILE_OBJECT, SET_ACCESS, SetEntriesInAclW, SetNamedSecurityInfoW,
    TRUSTEE_IS_GROUP, TRUSTEE_IS_SID, TRUSTEE_W, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE,
    REVOKE_ACCESS,
};
use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID};

use crate::sid::OwnedSid;
use crate::wide::to_wide;

// The individual file rights, named. `FILE_LIST_DIRECTORY` and `FILE_READ_DATA`
// are the same bit under two names, and so are `FILE_TRAVERSE` and
// `FILE_EXECUTE` — the meaning depends on whether the object is a directory.
// That aliasing is the whole enumeration trap: a mask that "obviously" only
// grants reading a file is also the mask that grants listing a folder.
const FILE_LIST_DIRECTORY: u32 = 0x0001; // == FILE_READ_DATA
const FILE_ADD_FILE: u32 = 0x0002; // == FILE_WRITE_DATA
const FILE_ADD_SUBDIRECTORY: u32 = 0x0004; // == FILE_APPEND_DATA
const FILE_READ_EA: u32 = 0x0008;
const FILE_WRITE_EA: u32 = 0x0010;
const FILE_TRAVERSE: u32 = 0x0020; // == FILE_EXECUTE
const FILE_DELETE_CHILD: u32 = 0x0040;
const FILE_READ_ATTRIBUTES: u32 = 0x0080;
const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
const DELETE: u32 = 0x0001_0000;
const READ_CONTROL: u32 = 0x0002_0000;
const SYNCHRONIZE: u32 = 0x0010_0000;

/// Everything needed to open a file **and** to enumerate a directory.
///
/// `FILE_LIST_DIRECTORY` is what the spike was missing in practice and
/// `FILE_READ_ATTRIBUTES` is what makes the listing show sizes and dates rather
/// than fail halfway. `FILE_TRAVERSE` is needed on every ancestor of anything
/// the child opens, not only on the leaf.
const READ_ACCESS: u32 = FILE_LIST_DIRECTORY
    | FILE_READ_EA
    | FILE_TRAVERSE
    | FILE_READ_ATTRIBUTES
    | READ_CONTROL
    | SYNCHRONIZE;

/// Read, plus creating, changing and removing entries.
///
/// `DELETE` is on the object; `FILE_DELETE_CHILD` is on its parent. A grant
/// with only the first lets a child empty a file but never remove it, which
/// surfaces much later as a tool that half works.
const WRITE_ACCESS: u32 = READ_ACCESS
    | FILE_ADD_FILE
    | FILE_ADD_SUBDIRECTORY
    | FILE_WRITE_EA
    | FILE_WRITE_ATTRIBUTES
    | FILE_DELETE_CHILD
    | DELETE;

/// Traverse only — enough to pass *through* a directory, not to look inside it.
///
/// This is what an ancestor of the workspace gets. Without it a child cannot
/// open `…\project\src\main.ts` even when `src` is fully granted, because the
/// kernel checks every component of the path. With only this, `dir` on that
/// ancestor is still refused, which is the intended shape: a corridor, not a
/// window.
const TRAVERSE_ACCESS: u32 = FILE_TRAVERSE | READ_CONTROL | SYNCHRONIZE;

const OBJECT_INHERIT_ACE: u32 = 0x1;
const CONTAINER_INHERIT_ACE: u32 = 0x2;

/// How much of a path a grant opens up.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Pass through this directory; do not list it.
    Traverse,
    /// Read and list, here and below.
    Read,
    /// Read, list, create, modify and delete, here and below.
    Write,
}

impl Mode {
    pub fn parse(text: &str) -> Result<Self, String> {
        match text {
            "traverse" => Ok(Mode::Traverse),
            "read" => Ok(Mode::Read),
            "write" => Ok(Mode::Write),
            other => Err(format!("unknown access mode: {other}")),
        }
    }

    fn mask(self) -> u32 {
        match self {
            Mode::Traverse => TRAVERSE_ACCESS,
            Mode::Read => READ_ACCESS,
            Mode::Write => WRITE_ACCESS,
        }
    }

    /// Whether the grant reaches the contents of the directory.
    ///
    /// A traverse grant deliberately does not inherit. Inheriting it would push
    /// a corridor into every child of the user's home directory, which is a far
    /// larger footprint on their disk than anything this feature is worth.
    fn inheritance(self) -> u32 {
        match self {
            Mode::Traverse => 0,
            Mode::Read | Mode::Write => OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
        }
    }
}

fn trustee(sid: PSID) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: std::ptr::null_mut(),
        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_GROUP,
        ptstrName: sid as *mut u16,
    }
}

/// Rewrites one trustee's entry in a path's DACL, leaving every other entry be.
///
/// `SetEntriesInAclW` merges into the existing list rather than replacing it,
/// which is what makes this safe to run on a directory the user cares about:
/// their own access, and everyone else's, is carried through untouched.
fn apply(path: &str, sid: &OwnedSid, access: u32, inheritance: u32, mode: i32) -> Result<(), String> {
    let wide_path = to_wide(path);
    let mut old_dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();

    let status = unsafe {
        GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("could not read the permissions of {path} (error {status})"));
    }

    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access,
        grfAccessMode: mode,
        grfInheritance: inheritance,
        Trustee: trustee(sid.raw()),
    };

    let mut new_dacl: *mut ACL = std::ptr::null_mut();
    let status = unsafe { SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl) };
    if status != ERROR_SUCCESS {
        unsafe { LocalFree(descriptor as _) };
        return Err(format!("could not build the new permissions for {path} (error {status})"));
    }

    let status = unsafe {
        SetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_dacl,
            std::ptr::null(),
        )
    };

    unsafe { LocalFree(new_dacl as _) };
    unsafe { LocalFree(descriptor as _) };

    if status != ERROR_SUCCESS {
        // Error 5 here is the drive-root case from the spike: writing an ACE on
        // `D:\` needs elevation. Reported as-is rather than retried, because the
        // only way to "work around" it is to ask for rights this feature has no
        // business holding.
        return Err(format!("could not set the permissions of {path} (error {status})"));
    }
    Ok(())
}

pub fn grant(path: &str, sid: &OwnedSid, mode: Mode) -> Result<(), String> {
    apply(path, sid, mode.mask(), mode.inheritance(), SET_ACCESS)
}

/// Removes every entry for this SID from the path's DACL.
///
/// The counterpart to `grant`, and the reason a workspace does not accumulate
/// permissions. It must run before the profile is deleted — afterwards the SID
/// is unresolvable and the ACE stays behind as an unreadable line in the user's
/// folder properties.
pub fn revoke(path: &str, sid: &OwnedSid) -> Result<(), String> {
    apply(path, sid, 0, 0, REVOKE_ACCESS)
}
