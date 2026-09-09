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

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, GetLastError, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SE_FILE_OBJECT, SET_ACCESS, SetEntriesInAclW, SetNamedSecurityInfoW,
    TRUSTEE_IS_GROUP, TRUSTEE_IS_SID, TRUSTEE_W, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE,
    REVOKE_ACCESS,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, EqualSid, GetAce,
    InitializeSecurityDescriptor, PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR,
    SetFileSecurityW, SetSecurityDescriptorDacl,
};

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

/// Pass *through* a directory and ask its attributes — never look inside it.
///
/// `FILE_READ_ATTRIBUTES` is here because of a measurement, not for symmetry.
/// A program that resolves its own path — which Node does for every main
/// module, and which most runtimes do somewhere — calls `realpath`, and that
/// stats **every ancestor up to the volume root**. Without this bit the stat of
/// `C:\` fails and the program dies before its first line, with an error that
/// names a path nobody asked it to touch.
///
/// `FILE_LIST_DIRECTORY` is deliberately absent. The holder may confirm that a
/// directory exists and walk through it; it may not learn what is in it. That
/// distinction is the whole reason this mode is safe to put on a volume root.
const TRAVERSE_ACCESS: u32 =
    FILE_TRAVERSE | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE;

/// Traverse, plus the one bit that lets a program resolve the directory it is
/// standing in.
///
/// This exists because of git, and the measurement is written up in
/// `documentation/work/git-sandbox-findings.md`. Git's `getcwd` on Windows
/// resolves its working directory through `GetFinalPathNameByHandleW`, and
/// when that does not answer it falls back to `GetLongPathNameW`, which maps
/// short names to long ones by *listing each component's parent*. Listing is
/// `FILE_LIST_DIRECTORY`, the one bit `TRAVERSE_ACCESS` deliberately omits, so
/// git died before it could look at a repository - on every workspace, with
/// the corridor otherwise complete. Node never noticed because its own path
/// resolution walks by `lstat`, which needs only traverse and read-attributes.
///
/// **What this costs, stated plainly.** A holder of this entry on the users
/// directory can list it - it learns the names of the accounts on the machine.
/// On the volume root it learns the top-level folder names. That is strictly
/// more than `TRAVERSE_ACCESS` gives away, and it is the reason this is a
/// separate mode rather than an extra bit on that one: it goes on the corridor
/// and nowhere else, and the corridor is a chain of directories whose *names*
/// the child already knows, because they are the ancestors of its own
/// workspace. It still does not inherit, so nothing one level below any of
/// them is reachable through it.
const CORRIDOR_ACCESS: u32 = TRAVERSE_ACCESS | FILE_LIST_DIRECTORY;

/// `ACCESS_ALLOWED_ACE_TYPE`. Not exported by `windows-sys`, and stable since
/// NT: a deny entry is type 1, and every other type is an audit or callback
/// entry that grants nothing.
const ACCESS_ALLOWED: u8 = 0;

/// `SECURITY_DESCRIPTOR_REVISION`. One, since NT, and the only value the API
/// accepts — `windows-sys` does not export it.
const DESCRIPTOR_REVISION: u32 = 1;

const OBJECT_INHERIT_ACE: u32 = 0x1;
const CONTAINER_INHERIT_ACE: u32 = 0x2;

/// How much of a path a grant opens up.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Pass through this directory; do not list it.
    Traverse,
    /// Pass through this directory and list it; reach nothing below it.
    Corridor,
    /// Read and list, here and below.
    Read,
    /// Read, list, create, modify and delete, here and below.
    Write,
}

impl Mode {
    pub fn parse(text: &str) -> Result<Self, String> {
        match text {
            "traverse" => Ok(Mode::Traverse),
            "corridor" => Ok(Mode::Corridor),
            "read" => Ok(Mode::Read),
            "write" => Ok(Mode::Write),
            other => Err(format!("unknown access mode: {other}")),
        }
    }

    fn mask(self) -> u32 {
        match self {
            Mode::Traverse => TRAVERSE_ACCESS,
            Mode::Corridor => CORRIDOR_ACCESS,
            Mode::Read => READ_ACCESS,
            Mode::Write => WRITE_ACCESS,
        }
    }

    /// Whether the grant reaches the contents of the directory.
    ///
    /// A traverse grant deliberately does not inherit. Inheriting it would push
    /// a corridor into every child of the user's home directory, which is a far
    /// larger footprint on their disk than anything this feature is worth.
    /// Whether changing this entry should push inheritance down the tree.
    ///
    /// False for `Traverse`, and that is not an optimisation. A traverse entry
    /// goes on a volume root, and propagating from there rewrites every
    /// security descriptor on the disk — see `set_this_object_only`.
    fn propagates(self) -> bool {
        !matches!(self, Mode::Traverse | Mode::Corridor)
    }

    fn inheritance(self) -> u32 {
        match self {
            Mode::Traverse | Mode::Corridor => 0,
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
fn apply(
    path: &str,
    sid: &OwnedSid,
    access: u32,
    inheritance: u32,
    mode: i32,
    propagate: bool,
) -> Result<(), String> {
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

    let outcome = if propagate {
        set_and_propagate(&wide_path, new_dacl)
    } else {
        set_this_object_only(&wide_path, new_dacl)
    };

    unsafe { LocalFree(new_dacl as _) };
    unsafe { LocalFree(descriptor as _) };

    if let Err(status) = outcome {
        // Error 5 is the unelevated drive-root case. Reported as-is rather than
        // retried, because the only way to "work around" it is to ask for rights
        // this feature has no business holding.
        return Err(format!("could not set the permissions of {path} (error {status})"));
    }
    Ok(())
}

/// The normal path: set the DACL and let Windows push inheritance downwards.
///
/// Correct for a workspace, and necessary there — files that already exist do
/// not pick up a new inheritable entry until something walks them.
fn set_and_propagate(wide_path: &[u16], dacl: *mut ACL) -> Result<(), u32> {
    let status = unsafe {
        SetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null(),
        )
    };
    if status == ERROR_SUCCESS { Ok(()) } else { Err(status) }
}

/// This directory's DACL and nothing else's.
///
/// **`SetNamedSecurityInfo` walks children.** Whenever a DACL changes it
/// recomputes inherited entries on every descendant — which is right for a
/// project folder and catastrophic for `C:\`, where it means rewriting the
/// security descriptor of every object on the disk. Run elevated on a volume
/// root it does not fail; it simply does not finish, and the first symptom is a
/// timeout that reads like the call was refused.
///
/// `SetFileSecurityW` is the older, narrower call: it sets the descriptor on the
/// named object and touches nothing below it. That is exactly what a
/// non-inheriting entry on a volume root wants, and it is why {@link Mode}
/// decides which call is used rather than the caller remembering.
fn set_this_object_only(wide_path: &[u16], dacl: *mut ACL) -> Result<(), u32> {
    let mut descriptor: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
    let pointer = &mut descriptor as *mut SECURITY_DESCRIPTOR as PSECURITY_DESCRIPTOR;

    if unsafe { InitializeSecurityDescriptor(pointer, DESCRIPTOR_REVISION) } == 0 {
        return Err(unsafe { GetLastError() });
    }
    // `daclDefaulted` false: this is a deliberate DACL, not one the system
    // invented, and marking it defaulted would let a later operation discard it.
    if unsafe { SetSecurityDescriptorDacl(pointer, 1, dacl, 0) } == 0 {
        return Err(unsafe { GetLastError() });
    }
    if unsafe { SetFileSecurityW(wide_path.as_ptr(), DACL_SECURITY_INFORMATION, pointer) } == 0 {
        return Err(unsafe { GetLastError() });
    }
    Ok(())
}

/// Whether a trustee already holds at least the rights a mode implies.
///
/// Read-only, and it exists so the harness can ask "is this machine prepared"
/// without attempting a write it is probably not allowed to make. Asking by
/// trying would mean a failed ACL write on the user's volume root every time
/// the question came up.
pub fn holds(path: &str, sid: &OwnedSid, mode: Mode) -> Result<bool, String> {
    let wide_path = to_wide(path);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();

    let status = unsafe {
        GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("could not read the permissions of {path} (error {status})"));
    }

    let wanted = mode.mask();
    let mut granted: u32 = 0;
    if !dacl.is_null() {
        let count = unsafe { (*dacl).AceCount } as u32;
        for index in 0..count {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 {
                continue;
            }
            let header = ace as *const ACE_HEADER;
            // Only allow entries count. A deny entry is not "not granted" — it
            // is a different answer — but a volume root carrying a deny for an
            // app package is a machine we should not try to reason about.
            if unsafe { (*header).AceType } != ACCESS_ALLOWED {
                continue;
            }
            let allowed = ace as *const ACCESS_ALLOWED_ACE;
            let ace_sid = unsafe { std::ptr::addr_of!((*allowed).SidStart) } as PSID;
            if unsafe { EqualSid(ace_sid, sid.raw()) } != 0 {
                granted |= unsafe { (*allowed).Mask };
            }
        }
    }

    unsafe { LocalFree(descriptor as _) };
    Ok(granted & wanted == wanted)
}

/// Whether this exact entry is already on the path, mask and inheritance both.
///
/// Stricter than {@link holds}, and for a different question. `holds` asks
/// whether the rights are present at all, summing every entry for the trustee,
/// which is the right question for "is this machine prepared". This asks
/// whether *this* grant has already been made — one entry carrying both the
/// rights and the inheritance flags — because that is what decides whether
/// writing it again would change anything.
///
/// The tree below is not inspected, and does not need to be: an inheritable
/// entry on the directory is inherited by everything created under it
/// afterwards, and the propagating write that first placed it already fixed
/// what existed before. The one state this does not repair is a tree left half
/// written by a propagation that died in the middle; `revoke` then `grant`
/// still does, and nothing here is a barrier to it.
fn already_applied(path: &str, sid: &OwnedSid, mode: Mode) -> Result<bool, String> {
    let wide_path = to_wide(path);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();

    let status = unsafe {
        GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("could not read the permissions of {path} (error {status})"));
    }

    let wanted_mask = mode.mask();
    let wanted_inheritance = mode.inheritance() as u8;
    let mut found = false;

    if !dacl.is_null() {
        let count = unsafe { (*dacl).AceCount } as u32;
        for index in 0..count {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 {
                continue;
            }
            let header = ace as *const ACE_HEADER;
            if unsafe { (*header).AceType } != ACCESS_ALLOWED {
                continue;
            }
            // Only the two inheritance bits are compared. Windows sets
            // `INHERITED_ACE` on the copies it pushes downwards and may set
            // `INHERIT_ONLY`; neither says anything about whether the entry we
            // asked for is here.
            let flags = unsafe { (*header).AceFlags } & (OBJECT_INHERIT_ACE as u8 | CONTAINER_INHERIT_ACE as u8);
            let allowed = ace as *const ACCESS_ALLOWED_ACE;
            let ace_sid = unsafe { std::ptr::addr_of!((*allowed).SidStart) } as PSID;
            if unsafe { EqualSid(ace_sid, sid.raw()) } == 0 {
                continue;
            }
            let mask = unsafe { (*allowed).Mask };
            if mask & wanted_mask == wanted_mask && flags == wanted_inheritance {
                found = true;
                break;
            }
        }
    }

    unsafe { LocalFree(descriptor as _) };
    Ok(found)
}

/// Places the entry, unless it is already exactly there.
///
/// **The skip is the point, not a saving.** A granting write with propagation
/// rewrites the security descriptor of every file under the path, and every
/// such rewrite is a change event to anything watching the directory — which,
/// on a project the user is developing, is their own toolchain. Studio's
/// desktop shell watches its own source tree, so an unconditional re-grant on
/// every start of a contained process made the shell rebuild, which restarted
/// the harness, which started the contained process again: an endless loop
/// with nothing in it that had actually changed. Measured on 2026-09-09 by
/// watching a directory across two identical grants; the second fired the same
/// events as the first, and now fires none.
pub fn grant(path: &str, sid: &OwnedSid, mode: Mode) -> Result<(), String> {
    if already_applied(path, sid, mode)? {
        return Ok(());
    }
    apply(path, sid, mode.mask(), mode.inheritance(), SET_ACCESS, mode.propagates())
}

/// Removes every entry for this SID from the path's DACL.
///
/// The counterpart to `grant`, and the reason a workspace does not accumulate
/// permissions. It must run before the profile is deleted — afterwards the SID
/// is unresolvable and the ACE stays behind as an unreadable line in the user's
/// folder properties.
pub fn revoke(path: &str, sid: &OwnedSid, mode: Mode) -> Result<(), String> {
    // The mode is asked for on the way *out* as well as the way in, and for the
    // same reason: undoing a non-inheriting entry must not walk the tree either.
    // Revoking a traverse entry on a user's home folder with propagation on is
    // the identical hang as granting one on `C:\`, and it appears at shutdown
    // rather than at startup, which is a worse place to find it.
    apply(path, sid, 0, 0, REVOKE_ACCESS, mode.propagates())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The corridor is the traverse entry plus exactly one bit.
    ///
    /// Pinned because the difference is the whole point and it is one
    /// character wide. A corridor that quietly grew a second right would widen
    /// what a contained child can see on the user's volume root, which is the
    /// one place this project has always refused to widen by accident.
    #[test]
    fn corridor_is_traverse_plus_listing_only() {
        assert_eq!(CORRIDOR_ACCESS, TRAVERSE_ACCESS | FILE_LIST_DIRECTORY);
        assert_eq!(CORRIDOR_ACCESS & !TRAVERSE_ACCESS, FILE_LIST_DIRECTORY);
    }

    /// The corridor stays on the directory it names.
    ///
    /// Inheritance here would push an entry onto every child of the user's
    /// home, and propagation would rewrite every descriptor on the volume -
    /// the two failures `Mode::Traverse` exists to avoid, which the new mode
    /// inherits by being in the same arms.
    #[test]
    fn corridor_neither_inherits_nor_propagates() {
        assert_eq!(Mode::Corridor.inheritance(), 0);
        assert!(!Mode::Corridor.propagates());
    }

    /// A mode is only usable if the command line can name it.
    #[test]
    fn corridor_parses_from_its_own_name() {
        assert!(matches!(Mode::parse("corridor"), Ok(Mode::Corridor)));
    }
}
