import { invoke } from "@tauri-apps/api/core";
import { apiManager } from "@/core/network/apiManager";
import { tokenManager } from "@/lib/tokenManager";

export interface LocalRegistryRecord { id:string; name:string; transport:string; enabled:boolean; available:boolean; credentialRef?:string; tools:unknown[]; verifiedAt?:string; autoReconnect:boolean }
export async function listLocalMcpRegistrations():Promise<LocalRegistryRecord[]>{return invoke("local_registry_list")}
export async function syncLocalRegistry(userId:string,machineId:string):Promise<void>{
  const payload=await invoke<Record<string,unknown>>("local_registry_sync_payload",{userId,machineId});
  const [{baseUrl},token]=await Promise.all([apiManager.getConfig(),tokenManager.getAccessToken()]);
  const response=await fetch(`${baseUrl.replace(/\/$/,"")}/studio/registry/sync/local`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload)});
  if(!response.ok)throw new Error(`Registry synchronization failed (${response.status}).`);
}
