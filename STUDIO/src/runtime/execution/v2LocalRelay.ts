import { invoke } from "@tauri-apps/api/core";
import { apiManager } from "@/core/network/apiManager";
import { tokenManager } from "@/lib/tokenManager";
export interface ExternalToolRequest { type:"tool.external_requested"; conversationId:string; payload:{toolCallId:string;serverId:string;toolName:string;input:unknown} }
export async function resolveV2LocalTool(request:ExternalToolRequest):Promise<void>{
  let result:unknown;let error:string|undefined;
  try{result=await invoke("mcp_call_tool",{server:request.payload.serverId,tool:request.payload.toolName,args:request.payload.input})}catch(cause){error=cause instanceof Error?cause.message:String(cause)}
  const [{baseUrl},token]=await Promise.all([apiManager.getConfig(),tokenManager.getAccessToken()]);
  const response=await fetch(`${baseUrl.replace(/\/$/,"")}/studio/runs/${encodeURIComponent(request.conversationId)}/external-tools/${encodeURIComponent(request.payload.toolCallId)}/resolve`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(error?{error}:{result})});
  if(!response.ok)throw new Error(`Local tool result was rejected (${response.status}).`);
}
