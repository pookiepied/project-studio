//! The one body type the listener answers with.
//!
//! Two shapes, because the listener serves two kinds of thing and they have
//! opposite requirements. A frontend asset or a JSON reply is known in full
//! before a byte is written, so it is one `Bytes` and a `Content-Length`. A
//! conversation stream is not: it arrives from the harness over minutes and
//! has to leave here as it arrives, because the whole point of the stream is
//! that the reader sees a turn while it happens.
//!
//! Buffering the second kind is the mistake this type exists to make
//! impossible. A proxy that collects a response before forwarding it turns a
//! live stream into a page that appears, complete, when the run ends — which
//! looks exactly like the streaming being broken, and would be blamed on the
//! browser client rather than on the hop that ate it.
//!
//! Written by hand rather than pulled from a stream-adapter crate: the whole
//! implementation is one `poll_frame`, and it keeps the listener's dependency
//! list at crates the binary already compiled.

use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use hyper::body::{Body, Frame, SizeHint};
use tokio::sync::mpsc::Receiver;

/// What a chunk of a streamed body can be: more bytes, or the reason the
/// stream stopped early.
///
/// The error arm matters. A stream that ends silently on a transport failure
/// is indistinguishable to the reader from a run that finished normally, and
/// the reader would show a turn as complete when it was actually cut off.
pub(crate) type Chunk = Result<Bytes, std::io::Error>;

/// A response body: either all of it at once, or a channel it arrives on.
pub(crate) enum RemoteBody {
    /// The whole body, already in hand. `None` once it has been handed over,
    /// which is how the single frame is delivered exactly once.
    Full(Option<Bytes>),
    /// Chunks as the harness produces them. The sender lives in a pump task
    /// (see `proxy.rs`); the channel closing is the end of the body.
    Streaming(Receiver<Chunk>),
}

impl RemoteBody {
    /// A body known in full.
    pub(crate) fn full(bytes: impl Into<Bytes>) -> Self {
        let bytes = bytes.into();
        if bytes.is_empty() {
            // An empty `Bytes` delivered as a frame is a frame carrying
            // nothing, which some readers report as a chunk. Saying "no
            // frames" instead keeps an empty body genuinely empty.
            Self::Full(None)
        } else {
            Self::Full(Some(bytes))
        }
    }

    /// A body that arrives over time.
    pub(crate) fn streaming(chunks: Receiver<Chunk>) -> Self {
        Self::Streaming(chunks)
    }
}

impl Body for RemoteBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        // Safe because neither arm is self-referential: `Bytes` and
        // `Receiver` are both `Unpin`, so moving out from behind the pin is
        // exactly as sound as owning them directly.
        match self.get_mut() {
            RemoteBody::Full(bytes) => Poll::Ready(bytes.take().map(|bytes| Ok(Frame::data(bytes)))),
            RemoteBody::Streaming(chunks) => match chunks.poll_recv(context) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(None) => Poll::Ready(None),
                Poll::Ready(Some(Ok(bytes))) => Poll::Ready(Some(Ok(Frame::data(bytes)))),
                Poll::Ready(Some(Err(error))) => Poll::Ready(Some(Err(error))),
            },
        }
    }

    fn is_end_stream(&self) -> bool {
        match self {
            RemoteBody::Full(bytes) => bytes.is_none(),
            // Not knowable without polling, and claiming the end early would
            // truncate the stream.
            RemoteBody::Streaming(_) => false,
        }
    }

    fn size_hint(&self) -> SizeHint {
        match self {
            RemoteBody::Full(None) => SizeHint::with_exact(0),
            RemoteBody::Full(Some(bytes)) => SizeHint::with_exact(bytes.len() as u64),
            // Unknown, which is what makes hyper choose chunked transfer
            // encoding rather than announce a length it would then break.
            RemoteBody::Streaming(_) => SizeHint::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn a_full_body_is_one_frame_and_then_the_end() {
        let mut body = RemoteBody::full("hello");
        let first = body.frame().await.unwrap().unwrap();
        assert_eq!(first.into_data().unwrap(), Bytes::from("hello"));
        assert!(body.frame().await.is_none());
    }

    #[tokio::test]
    async fn an_empty_body_carries_no_frame_at_all() {
        let mut body = RemoteBody::full("");
        assert!(body.frame().await.is_none());
        assert!(body.is_end_stream());
        assert_eq!(body.size_hint().exact(), Some(0));
    }

    #[tokio::test]
    async fn a_streaming_body_delivers_chunks_in_order_and_ends_when_the_channel_closes() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender.send(Ok(Bytes::from("one"))).await.unwrap();
        sender.send(Ok(Bytes::from("two"))).await.unwrap();
        drop(sender);

        let mut body = RemoteBody::streaming(receiver);
        // Announcing no length is what makes hyper stream this rather than
        // buffer it to compute a Content-Length.
        assert_eq!(body.size_hint().exact(), None);
        assert!(!body.is_end_stream());

        let mut seen = Vec::new();
        while let Some(frame) = body.frame().await {
            seen.push(frame.unwrap().into_data().unwrap());
        }
        assert_eq!(seen, vec![Bytes::from("one"), Bytes::from("two")]);
    }

    #[tokio::test]
    async fn a_stream_that_breaks_reports_the_break_rather_than_ending_quietly() {
        // The distinction the error arm exists for: a cut-off run must not
        // read to the client as a run that finished.
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender.send(Ok(Bytes::from("partial"))).await.unwrap();
        sender
            .send(Err(std::io::Error::other("the harness went away")))
            .await
            .unwrap();
        drop(sender);

        let mut body = RemoteBody::streaming(receiver);
        assert_eq!(
            body.frame().await.unwrap().unwrap().into_data().unwrap(),
            Bytes::from("partial")
        );
        let error = body.frame().await.unwrap().unwrap_err();
        assert!(error.to_string().contains("the harness went away"));
    }
}
