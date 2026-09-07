# Handover — provider protocol research

Paste the fenced block below as the task. The prose here is for you.

**This is safe to run alongside the step 4 agent.** It writes exactly one new
file and changes no code, so there is nothing for the two to collide over. It
is told this explicitly, and told which files it must not touch.

**It recommends, it does not decide.** The curated provider list is a product
call with a permanent maintenance cost attached, so the deliverable is the
evidence and a recommendation, not a chosen list.

**The one thing it must actually do** is apply the no-webhook filter to real
providers. We know the rule; nobody has yet checked which providers survive it.
That single question may remove several candidates before any other criterion
is considered.

---

```
You are doing research for Project Studio, a local-first agent harness at
`C:\pookiepied\Dev Workspace\Project Studio`.

THIS IS A RESEARCH TASK. You write exactly ONE new file:
`documentation/work/provider-protocol-research.md`. You change no code, no
tests, and no existing document. You do not commit. Another agent is working
in this repo at the same time, so touching anything else risks destroying its
work.

Do NOT edit: `documentation/work/capability-discovery-plan.md`,
`documentation/work/provider-architecture-brief.md`, anything under `STUDIO/`
or `STUDIO HARNESS/`.

READ FIRST:
1. `documentation/work/provider-architecture-brief.md` — the whole thing. It
   is the architectural half of this work, already done. §2 says what the
   codebase already has, §2a scopes the language gateway, §3 gives the shape
   of the answer, §5 lists what is undecided. Your job is the half it does not
   do: the actual protocols.
2. `STUDIO HARNESS/src/contracts/providers.ts` — the real contract. Note
   `providerKindSchema`, `mediaProtocolSchema`, `invocationShapeSchema` and
   `CAPABILITY_SLOTS`. Your findings have to land inside these or say plainly
   that they cannot.
3. `C:\Users\pooki\.claude\CLAUDE.md` — the user's communication rules.

FIVE FACTS ABOUT OUR SITUATION. Do not re-derive them; they constrain
everything you conclude.

1. NO WEBHOOKS, EVER. `invocationShapeSchema` allows `stream`, `sync`, `poll`
   and deliberately excludes webhooks: they need a publicly reachable inbound
   URL and this harness runs on a person's machine behind NAT. A provider that
   can ONLY deliver results by webhook cannot be supported at all. THIS IS THE
   FILTER NOBODY HAS APPLIED YET AND IT IS THE MOST IMPORTANT PART OF THIS
   TASK. For every video provider especially, answer: is there a polling
   endpoint, or is a callback the only way to learn the job finished?
2. The tool surface is ours (`studio_image_generate`, not the vendor's names),
   with a per-provider adapter underneath. So what matters is the wire shape,
   not how pleasant the vendor's SDK is. Assume we call the HTTP API directly.
3. Adapter count is the cost, not provider count. An aggregator that
   normalises many models behind one request shape is worth several direct
   integrations. Weigh accordingly.
4. Web search and fetch are ALREADY BUILT — Brave, Exa, Firecrawl, Jina and
   Tavily all exist in `STUDIO HARNESS/src/retrieval/providers/` and are wired
   with search/reader roles. Do not propose building them. Your only question
   there is in the scope list below.
5. Credentials are a user-supplied API key held in the OS keychain. A provider
   needing OAuth, a service account, or cloud IAM signing is a much heavier
   integration; say so loudly when you find one.

WHAT TO RESEARCH. For each provider below, and for each capability it offers
that we care about:

  - Endpoint and request shape: how a generation is submitted, in outline.
  - How you wait: `sync`, `poll`, `stream`, or webhook-only. If polling, what
    the poll endpoint is and whether job ids are durable across a restart.
  - How the result comes back: bytes inline, base64, or a URL — and if a URL,
    how long it lives, because that decides whether we must download it
    immediately.
  - Auth: plain API key, or something heavier.
  - Whether it supports the image-editing case (an input image, not just a
    prompt) and image-to-video, since those are separate capability slots.
  - Anything that would force a change to our contract — a new
    `invocationShape`, a new `mediaProtocol`, a credential shape we cannot
    hold.

PROVIDERS. The user named these; treat the list as the scope.

  Aggregators:      OpenRouter, FAL, Replicate
  Image:            OpenAI (gpt-image-1), Google (Imagen/Gemini image),
                    Black Forest Labs (FLUX), Runway
  Video:            Google (Veo), Runway, FAL-hosted video models,
                    Minimax, Alibaba (Wan)
  Text to speech:   ElevenLabs, OpenAI, Google, Fish Audio, Minimax
  Speech to text:   Deepgram, OpenAI (Whisper / gpt-4o-transcribe),
                    ElevenLabs (Scribe), Google
  Deferred:         RunPod and ComfyUI are infrastructure a user operates
                    rather than providers with a catalogue. One paragraph on
                    why they are a different category, and no further work.

Also answer, in one short section: our retrieval split gives search to Tavily,
Brave and Exa and page-reading to Jina and Firecrawl. Is that still the right
division given what each vendor does today, and is any of our five
implementations using an endpoint the vendor has since superseded? This is a
review, not a rebuild.

HOW TO RESEARCH. Use web search and fetch the vendors' own API documentation.
Do NOT answer from memory: these APIs change often, your training data is
stale, and a confidently wrong request shape here becomes an adapter someone
writes and then debugs for a day. Cite the documentation URL for every
provider you cover. Where you cannot confirm something, write "unconfirmed"
and say what you could not find — an honest gap is far more useful than a
plausible guess, because a gap gets checked and a guess gets built.

THE DELIVERABLE. One document, structured as:

  1. A one-page summary: what you would support, in what order, and why.
  2. A table per modality (image, video, TTS, ASR): provider, wait shape,
     result shape, auth, survives-no-webhook yes/no.
  3. A section per provider with the detail and its citation.
  4. Recommended adapter list, with the reasoning stated as a trade — what
     each adapter buys and what it costs us permanently.
  5. Contract impact: anything that does not fit `mediaProtocolSchema`,
     `invocationShapeSchema` or the capability slots as they stand.
  6. What you could not confirm.

RECOMMEND, DO NOT DECIDE. Which providers we support is a product decision
with a permanent maintenance cost, and it is the user's to make. Give them the
evidence and your recommendation, clearly separated.

House style: full sentences, and say WHY rather than only what. When you
recommend against something, say what it would have bought us, so the person
reading knows what they are giving up.

REPORT when done: the headline recommendation in a few sentences, the count of
providers that failed the no-webhook filter, and anything you found that
contradicts the architecture brief — that last one matters most, because the
brief was written without any of this evidence.
```
