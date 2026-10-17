use rand::RngCore;

/// Native identities use the same cryptographic UUIDv4 format as the JS runtimes.
pub(crate) fn new_uuid() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

pub(crate) fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36 && bytes[14] == b'4' && matches!(bytes[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B') &&
        bytes.iter().enumerate().all(|(at, byte)| if [8, 13, 18, 23].contains(&at) { *byte == b'-' } else { byte.is_ascii_hexdigit() })
}

pub(crate) fn request_id(headers: &mut Option<Vec<(String, String)>>) -> String {
    let headers = headers.get_or_insert_with(Vec::new);
    let id = headers.iter().find(|(key, value)| key.eq_ignore_ascii_case("x-project-studio-request-id") && is_uuid(value))
        .map(|(_, value)| value.clone()).unwrap_or_else(new_uuid);
    headers.retain(|(key, _)| !key.eq_ignore_ascii_case("x-project-studio-request-id"));
    headers.push(("x-project-studio-request-id".to_owned(), id.clone()));
    id
}

/// Window labels preserve opaque conversation identity without lossy sanitizing.
pub(crate) fn browser_window_label(conversation_id: &str) -> String {
    let encoded: String = conversation_id.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect();
    format!("browser-{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_windows_do_not_merge_distinct_opaque_conversation_ids() {
        assert_ne!(browser_window_label("cnv/a"), browser_window_label("cnv?a"));
        assert_eq!(browser_window_label("cnv/a"), browser_window_label("cnv/a"));
        assert!(browser_window_label("\u{03bb}/a").bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));
    }
    #[test]
    fn native_ids_are_distinct_uuid_v4_values() {
        let first = new_uuid();
        assert!(is_uuid(&first));
        assert_ne!(first, new_uuid());
        assert!(!is_uuid("not-an-identity"));
    }
    #[test]
    fn request_identity_preserves_one_valid_header_and_replaces_invalid_duplicates() {
        let expected = new_uuid();
        let mut headers = Some(vec![("X-Project-Studio-Request-Id".to_owned(), "invalid".to_owned()),
            ("x-project-studio-request-id".to_owned(), expected.clone())]);
        assert_eq!(request_id(&mut headers), expected);
        assert_eq!(headers.as_ref().unwrap().len(), 1);
        let mut absent = None;
        assert!(is_uuid(&request_id(&mut absent)));
    }
}
