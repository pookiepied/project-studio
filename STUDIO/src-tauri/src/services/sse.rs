//! Server-Sent Events framing, and nothing else.
//!
//! Written by hand rather than pulled in as a dependency because the framing
//! is small and the edge cases are the whole difficulty: where a chunk
//! boundary falls is arbitrary, and the bugs live at the boundaries rather
//! than in the field grammar. This project already paid for that knowledge
//! once -- the TypeScript parser deleted with the cloud gateway (commit
//! `45233d5`) carried eleven tests for exactly these cases -- and the list
//! below is that list, transferred rather than re-derived.
//!
//! Bytes are buffered, not text: a multi-byte UTF-8 character can straddle a
//! chunk boundary, and decoding each chunk independently would corrupt it
//! silently. A line is only decoded once its terminator has arrived, and a
//! terminator is ASCII, so a complete line is always whole characters.
//!
//! What this module does not know: HTTP, channels, offsets, the Harness.
//! Parsing is separated from delivery so both can be tested alone.

use std::str::Utf8Error;

/// One dispatched block: an optional event name and its data, joined.
///
/// A block with no `data:` line is a keep-alive and never becomes one of
/// these; comments and unknown fields (`id`, `retry`) never do either.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SseFrame {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Debug, Default)]
pub(crate) struct SseParser {
    /// Bytes not yet resolved into a complete line.
    buffer: Vec<u8>,
    /// The block under construction. Dispatched -- or dropped, if it never
    /// gained a `data:` line -- by the next blank line.
    event: Option<String>,
    data: Option<String>,
}

impl SseParser {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Feeds one chunk and returns every frame it completed.
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseFrame>, Utf8Error> {
        self.buffer.extend_from_slice(chunk);
        self.drain_completed_lines(false)
    }

    /// Ends the stream: a trailing lone `\r` is resolved as a line break --
    /// which can complete a block -- and whatever then remains has no
    /// terminator, so it is a truncated frame and is discarded rather than
    /// half-emitted.
    pub(crate) fn finish(&mut self) -> Result<Vec<SseFrame>, Utf8Error> {
        let frames = self.drain_completed_lines(true)?;
        self.buffer.clear();
        self.event = None;
        self.data = None;
        Ok(frames)
    }

    fn drain_completed_lines(&mut self, at_eof: bool) -> Result<Vec<SseFrame>, Utf8Error> {
        let mut frames = Vec::new();
        while let Some(line) = self.next_line(at_eof) {
            if let Some(frame) = self.ingest_line(&line)? {
                frames.push(frame);
            }
        }
        Ok(frames)
    }

    /// Removes and returns the next complete line, without its terminator.
    ///
    /// `None` when the buffer holds no decidable line end. The one undecided
    /// case is a `\r` as the very last byte: it is either half of a CRLF or
    /// a lone-carriage-return line break, and those are one line break and
    /// not two -- deciding early was the bug the old parser's CRLF tests
    /// existed for, where one break became two and split a frame in half.
    /// More bytes decide it; only the end of the stream may decide it as
    /// lone.
    fn next_line(&mut self, at_eof: bool) -> Option<Vec<u8>> {
        for (index, byte) in self.buffer.iter().enumerate() {
            let terminator_len = match byte {
                b'\n' => 1,
                b'\r' => match self.buffer.get(index + 1) {
                    Some(b'\n') => 2,
                    Some(_) => 1,
                    None if at_eof => 1,
                    None => return None,
                },
                _ => continue,
            };
            let line: Vec<u8> = self.buffer.drain(..index + terminator_len).take(index).collect();
            return Some(line);
        }
        None
    }

    /// Applies one line to the block under construction, returning a frame
    /// exactly when the line was blank and the block had data.
    fn ingest_line(&mut self, line: &[u8]) -> Result<Option<SseFrame>, Utf8Error> {
        if line.is_empty() {
            let frame = match self.data.take() {
                Some(data) => Some(SseFrame {
                    event: self.event.take(),
                    data,
                }),
                // A block with no data is a keep-alive, not an event.
                None => {
                    self.event = None;
                    None
                }
            };
            return Ok(frame);
        }
        if line[0] == b':' {
            // A comment. Nothing to parse; used by servers as heartbeats.
            return Ok(None);
        }
        let text = std::str::from_utf8(line)?;
        // The spec strips exactly one space after the field colon, so
        // `data:x` and `data: x` are the same and `data:  x` keeps one space.
        // The harness emits no space, so both shapes must work.
        let (name, value) = match text.split_once(':') {
            Some((name, value)) => (name, value.strip_prefix(' ').unwrap_or(value)),
            None => (text, ""),
        };
        match name {
            "event" => self.event = Some(value.to_owned()),
            "data" => match &mut self.data {
                Some(data) => {
                    data.push('\n');
                    data.push_str(value);
                }
                None => self.data = Some(value.to_owned()),
            },
            // `id`, `retry`, and anything unknown: ignored, as the spec says.
            _ => {}
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stream, delivered as exactly these chunks, so a frame can be cut
    /// at a chosen byte. Network chunk boundaries are arbitrary, and the
    /// bugs live at the boundaries rather than in the parsing.
    fn frames_of(chunks: &[&str]) -> Result<Vec<SseFrame>, Utf8Error> {
        let mut parser = SseParser::new();
        let mut frames = Vec::new();
        for chunk in chunks {
            frames.extend(parser.push(chunk.as_bytes())?);
        }
        frames.extend(parser.finish()?);
        Ok(frames)
    }

    #[test]
    fn keeps_the_event_name_with_its_data() {
        let frames = frames_of(&["event: message\ndata: hello\n\n"]).expect("valid");
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("message".to_owned()),
                data: "hello".to_owned(),
            }]
        );
    }

    #[test]
    fn joins_multi_line_data_with_newlines_as_the_spec_requires() {
        let frames = frames_of(&["data: one\ndata: two\n\n"]).expect("valid");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "one\ntwo");
        assert_eq!(frames[0].event, None);
    }

    #[test]
    fn ignores_comment_lines() {
        let frames = frames_of(&[": keep-alive\ndata: hello\n\n"]).expect("valid");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "hello");
    }

    #[test]
    fn drops_a_block_with_no_data_which_is_what_a_keep_alive_is() {
        // The harness heartbeats exactly this way: `: heartbeat`, a comment
        // block every 15s to keep an otherwise idle stream observable.
        assert_eq!(frames_of(&[": keep-alive\n\n"]).expect("valid"), vec![]);
        assert_eq!(frames_of(&["event: ping\n\n"]).expect("valid"), vec![]);
    }

    #[test]
    fn reads_whole_frames() {
        let frames = frames_of(&["event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"]).expect("valid");
        assert_eq!(
            frames,
            vec![
                SseFrame {
                    event: Some("a".to_owned()),
                    data: "1".to_owned(),
                },
                SseFrame {
                    event: Some("b".to_owned()),
                    data: "2".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn joins_a_frame_split_anywhere_in_the_middle() {
        let frames = frames_of(&["event: a\nda", "ta: 1\n\n"]).expect("valid");
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("a".to_owned()),
                data: "1".to_owned(),
            }]
        );
    }

    #[test]
    fn keeps_a_crlf_frame_whole_when_the_chunk_ends_on_the_carriage_return() {
        // The failure this exists for: a lone trailing `\r` decided
        // prematurely becomes two line breaks, one block splits in half, and
        // the half without a `data:` line is dropped -- taking the event name
        // with it.
        let frames = frames_of(&["event: a\r\ndata: 1\r", "\n\r\n"]).expect("valid");
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("a".to_owned()),
                data: "1".to_owned(),
            }]
        );
    }

    #[test]
    fn survives_a_crlf_cut_at_every_position_in_the_stream() {
        // One cut position is a guess about where the network splits. Every
        // position is not.
        let payload = "event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n";
        for cut in 1..payload.len() {
            let (head, tail) = payload.split_at(cut);
            let frames = frames_of(&[head, tail]).expect("valid");
            assert_eq!(
                frames,
                vec![
                    SseFrame {
                        event: Some("a".to_owned()),
                        data: "1".to_owned(),
                    },
                    SseFrame {
                        event: Some("b".to_owned()),
                        data: "2".to_owned(),
                    },
                ],
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn reads_a_stream_that_uses_lone_carriage_returns_as_line_breaks() {
        // Legal per the spec, rare in practice. The trailing `\r` is
        // undecided until the stream ends, so this only completes in
        // `finish` -- which is the honest reading: mid-stream, that byte
        // could still be half of a CRLF.
        let frames = frames_of(&["event: a\rdata: 1\r\r"]).expect("valid");
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("a".to_owned()),
                data: "1".to_owned(),
            }]
        );
    }

    #[test]
    fn discards_a_truncated_trailing_frame_rather_than_emitting_half_of_it() {
        let frames = frames_of(&["event: a\ndata: 1\n\nevent: b\ndata: par"]).expect("valid");
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("a".to_owned()),
                data: "1".to_owned(),
            }]
        );
    }

    #[test]
    fn handles_a_multi_byte_character_split_across_chunks() {
        // A UTF-8 sequence straddling a chunk boundary is the case that
        // bites: decoding per chunk corrupts it, silently.
        let bytes = "data: é\n\n".as_bytes();
        let mut parser = SseParser::new();
        let mut frames = parser.push(&bytes[..7]).expect("valid");
        frames.extend(parser.push(&bytes[7..]).expect("valid"));
        frames.extend(parser.finish().expect("valid"));
        assert_eq!(
            frames,
            vec![SseFrame {
                event: None,
                data: "é".to_owned(),
            }]
        );
    }

    #[test]
    fn strips_exactly_one_space_after_the_field_colon() {
        // The harness emits `data:{json}` with no space; the spec's canonical
        // shape has one. Both are one JSON string, and a second space is
        // content, not decoration.
        let frames = frames_of(&["data:no-space\ndata: one-space\ndata:  two\n\n"]).expect("valid");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "no-space\none-space\n two");
    }

    #[test]
    fn a_completed_line_that_is_not_utf8_is_an_error_not_a_replacement() {
        // `\xff` is not valid in any UTF-8 sequence. Silently replacing it
        // with U+FFFD would corrupt the event data; failing the stream is
        // the honest reading, and callers classify it as broken-after-start.
        let mut parser = SseParser::new();
        assert!(parser.push(b"data: \xff\n\n").is_err());
    }
}
