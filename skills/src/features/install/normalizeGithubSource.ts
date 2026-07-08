/**
 * Normalize a GitHub source URL into (owner, repo, ref, subPath) without
 * performing any network I/O. Accepts the common forms:
 *   https://github.com/<owner>/<repo>
 *   https://github.com/<owner>/<repo>/tree/<ref>/[subPath]
 *   https://github.com/<owner>/<repo>/blob/<ref>/<file>
 *   git@github.com:<owner>/<repo>[.git]
 *   <owner>/<repo>
 */
export interface NormalizedGithubSource {
  owner: string;
  repo: string;
  ref: string | null;
  subPath: string | null;
  rawBase: string;
  cloneUrl: string;
}

const GH_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*)?)?\/?$/i;

export function normalizeGithubSource(source: string): NormalizedGithubSource | null {
  const s = source.trim();
  if (!s) return null;

  let owner = "";
  let repo = "";
  let ref: string | null = null;
  let subPath: string | null = null;

  // git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(s);
  if (ssh) {
    [, owner, repo] = ssh;
  } else {
    // owner/repo shorthand
    const short = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(s);
    if (short && !s.includes("://") && !s.includes("/")) {
      // Pure "owner/repo" form — short.exec requires exactly two segments
    }
    const m = GH_RE.exec(s) ?? (short ? (/,/.test(s) ? null : short as RegExpExecArray) : null);
    if (!m) return null;
    owner = m[1];
    repo = m[2];
    ref = m[3] ?? null;
    subPath = m[4] ? m[4].replace(/^\/+/, "").replace(/\/+$/, "") : null;
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? "HEAD"}`;

  return { owner, repo, ref, subPath, rawBase, cloneUrl };
}
