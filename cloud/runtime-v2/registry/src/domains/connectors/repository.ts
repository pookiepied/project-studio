import type { RegistryConnectorRecord } from "@studio/v2-contracts";

type Row = Record<string, unknown>;
export async function listConnectors(db: D1Database, userId: string): Promise<RegistryConnectorRecord[]> {
  const result = await db.prepare("SELECT * FROM connectors WHERE user_id = ? ORDER BY name").bind(userId).all<Row>();
  return (result.results ?? []).map(toRecord);
}
export async function getConnector(db: D1Database, userId: string, id: string): Promise<RegistryConnectorRecord | null> {
  const row = await db.prepare("SELECT * FROM connectors WHERE user_id=? AND id=?").bind(userId,id).first<Row>();
  return row ? toRecord(row) : null;
}
export async function upsertConnector(db:D1Database, r:RegistryConnectorRecord):Promise<void>{
  await db.prepare(`INSERT INTO connectors (id,user_id,name,origin,enabled,authenticated,available,capabilities,permissions,config_ref,metadata,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(id,user_id) DO UPDATE SET name=excluded.name,origin=excluded.origin,
  enabled=excluded.enabled,authenticated=excluded.authenticated,available=excluded.available,capabilities=excluded.capabilities,
  permissions=excluded.permissions,config_ref=excluded.config_ref,metadata=excluded.metadata,updated_at=datetime('now')`)
  .bind(r.ref.id,r.userId,r.ref.name,r.origin,Number(r.enabled),Number(r.authenticated),Number(r.available),JSON.stringify(r.tools),JSON.stringify(r.permissions),r.configRef??null,JSON.stringify(r.metadata)).run();
}
export async function deleteConnector(db:D1Database,userId:string,id:string):Promise<void>{await db.prepare("DELETE FROM connectors WHERE user_id=? AND id=?").bind(userId,id).run();}
function toRecord(row:Row):RegistryConnectorRecord{return {ref:{id:String(row.id),kind:"connector",name:String(row.name)},userId:String(row.user_id),origin:row.origin as RegistryConnectorRecord["origin"],location:"cloud",enabled:Boolean(row.enabled),available:Boolean(row.available),authenticated:Boolean(row.authenticated),tools:parse(row.capabilities,[]),permissions:parse(row.permissions,[]),configRef:row.config_ref?String(row.config_ref):undefined,metadata:parse(row.metadata,{})};}
function parse<T>(v:unknown,f:T):T{try{return JSON.parse(String(v)) as T}catch{return f}}
