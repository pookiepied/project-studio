import type { AgentDefinition } from "@studio/v2-contracts";

/**
 * D1 repository for agent definitions (versioned JSON records). Covers both
 * user-created and Studio-provided agents. Every query is user-scoped.
 */

export async function listAgents(
  db: D1Database,
  userId: string,
): Promise<AgentDefinition[]> {
  const result=await db.prepare("SELECT definition FROM agents WHERE user_id=? ORDER BY name").bind(userId).all<{definition:string}>();
  return (result.results??[]).map(r=>JSON.parse(r.definition) as AgentDefinition);
}

export async function getAgent(
  db: D1Database, userId: string, agentId: string,
): Promise<AgentDefinition | null> {
  const row=await db.prepare("SELECT definition FROM agents WHERE user_id=? AND id=?").bind(userId,agentId).first<{definition:string}>();return row?JSON.parse(row.definition) as AgentDefinition:null;
}
export async function upsertAgent(db:D1Database,a:AgentDefinition):Promise<void>{await db.prepare(`INSERT INTO agents(id,user_id,name,origin,version,enabled,location,definition,updated_at) VALUES(?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(id,user_id) DO UPDATE SET name=excluded.name,origin=excluded.origin,version=excluded.version,enabled=excluded.enabled,location=excluded.location,definition=excluded.definition,updated_at=datetime('now')`).bind(a.id,a.userId,a.name,a.origin,a.version,Number(a.enabled),a.runtime.location,JSON.stringify(a)).run();}
export async function deleteAgent(db:D1Database,userId:string,id:string):Promise<boolean>{const result=await db.prepare("DELETE FROM agents WHERE user_id=? AND id=?").bind(userId,id).run();return result.meta.changes>0;}
