/**
 * A rule is `METHOD /path`, where METHOD may be `ALL` and the path may end in
 * `*`. Matching is exact and case-sensitive apart from the method — no regex,
 * no implicit prefixes. A rule that is slightly wrong should fail closed
 * (nothing matches, so the route stays protected) rather than open.
 */
export type Rule = string;

export function parseRule(rule: Rule): { method: string; path: string; prefix: boolean } {
  const idx = rule.indexOf(" ");
  if (idx < 0) throw new Error(`malformed rule (expected "METHOD /path"): ${rule}`);
  const method = rule.slice(0, idx).toUpperCase();
  let path = rule.slice(idx + 1).trim();
  if (!path.startsWith("/")) throw new Error(`rule path must start with "/": ${rule}`);
  const prefix = path.endsWith("*");
  if (prefix) path = path.slice(0, -1);
  return { method, path, prefix };
}

export function matches(rules: readonly Rule[], method: string, path: string): boolean {
  for (const rule of rules) {
    const r = parseRule(rule);
    if (r.method !== "ALL" && r.method !== method.toUpperCase()) continue;
    if (r.prefix ? path.startsWith(r.path) : path === r.path) return true;
  }
  return false;
}
