export const DOCUMENT_WORKFLOW = `# Document Workflow

Load this skill before any task involving uploaded files, indexed books, documentation, or the rag tool.

---

## When a Document is First Indexed

After a user uploads a file or after \`index_document\` completes, the response includes a \`chapters\` array. Use it immediately:

1. **Present the structure** — tell the user what you found: source name, total chunks, chapter list if detected
2. **Ask before exploring** — for any document over a few pages, confirm what the user wants:
   - "Your calculus textbook has 12 chapters: [Introduction, Limits, Derivatives...]. Where would you like to start?"
   - "I can give you an overview, work through a specific chapter, or answer questions about any topic in the book."
3. **Do not dump retrieved content unprompted** — synthesize and present, don't paste raw chunks

---

## Returning to a Previously Indexed Document

If the user references a document that was indexed in a prior session:

\`\`\`
rag(action="toc", session_id="<the session_id from when it was indexed")
\`\`\`

This retrieves the chapter list instantly from cache. Use the result to orient the user before querying.

If TOC is not found: the document was indexed before chapter detection existed. Offer to re-index it.

---

## Querying — Use the Right Filter

**No filter — searching across the whole document:**
\`\`\`
rag(action="query", session_id="...", query="...", top_k=5)
\`\`\`
Use when the user's question doesn't mention a specific chapter or location.

**Chapter filter — user mentions a specific chapter:**
\`\`\`
rag(action="query", session_id="...", query="...", chapter="7", top_k=5)
\`\`\`
Always use \`chapter=\` when the user says "chapter 7", "the derivatives chapter", etc. It prevents results from unrelated chapters bleeding in.

**Section filter — user wants a specific section:**
\`\`\`
rag(action="query", session_id="...", query="...", chapter="7", section="7.2", top_k=5)
\`\`\`

**Discovery queries — user doesn't know where something is:**
Use \`top_k=10\` with no filter. Results include \`chapter_label\` fields — use them to orient the user: "The most relevant content is in chapters 3 and 7..."

---

## Working Through a Chapter

When a user says "let's work on chapter 7" or "explain chapter 7":

1. Query with a broad overview: \`query="main topics and overview", chapter="7", top_k=8\`
2. Present a brief summary of what chapter 7 covers
3. Ask what specifically they need help with
4. Then run targeted queries for their actual questions

---

## Handling Large Documents (Books, Long PDFs)

- **The entire document is always indexed** — nothing is cut off, regardless of file size
- **Each query retrieves only the most relevant chunks** — this is intentional, not a limitation
- **1M-token context models**: even large books are fully accessible; the model only reads the relevant 5–10 chunks per query, not the whole document
- **You never need to worry about document size** — RAG handles it transparently

For a 1000-page calculus textbook: every chapter is accessible. Use chapter filters to navigate. The student does not need to re-upload or chunk anything manually.

---

## Studio Harness: Indexing Local Files

When the user is on Studio Harness and references a local documentation file:

\`\`\`
index_document(path="/absolute/path/to/file.md", session_id="optional-custom-id")
\`\`\`

- Works for: \`.md\`, \`.txt\`, \`.rst\`, \`.html\`, \`.json\`, \`.csv\`, \`.log\`
- Does NOT work for: PDFs (binary) — use the Studio chat upload for PDFs
- Returns: \`session_id\`, chunk count, chapter list
- After indexing: query using the returned \`session_id\`

---

## What NOT to Do

- Do not read documentation files with \`read_file\` unless they are small (<16KB) — use RAG instead
- Do not try to "read the whole document" — query for what you need
- Do not repeat the same query if results feel incomplete — rephrase or broaden the search
- Do not paste raw chunk text at the user — synthesize it into a clear response
`;
