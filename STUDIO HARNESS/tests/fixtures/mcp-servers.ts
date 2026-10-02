/**
 * Minimal MCP stdio servers, as source for `node <script>`.
 *
 * These were written inside `stop.test.ts` for the timeout and MCP-tool
 * cancellation half of 008.2 and for a while used by no test — kept, and
 * moved here rather than deleted, because deleting them would have erased
 * the only evidence that the coverage was planned and missing (#66).
 *
 * `SLOW_SERVER` is now that coverage's server: the cancellation test in
 * `mcp-runtime.test.ts` mounts it, discovers through the gate, and aborts
 * the call mid-flight. `ECHO_SERVER` stays beside it as the ordinary shape —
 * a server that answers immediately — for the next test that needs one
 * without the wait; presence here is availability, not coverage.
 */

export const ECHO_SERVER = `
process.stdin.setEncoding("utf8");
let buf="";
function reply(id, result){ process.stdout.write(JSON.stringify({ jsonrpc:"2.0", id, result })+"\\n"); }
function handle(m){
  if(m.method==="server/discover") reply(m.id,{protocolVersion:"2026-07-28",capabilities:{}});
  else if(m.method==="tools/list") reply(m.id,{tools:[{name:"echo",description:"Echo",inputSchema:{type:"object",properties:{text:{type:"string"}}}}]});
  else if(m.method==="tools/call") reply(m.id,{content:[{type:"text",text:m.params.arguments.text}]});
}
process.stdin.on("data",c=>{buf+=c; for(;;){const i=buf.indexOf("\\n"); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(line.trim()!=="") handle(JSON.parse(line));}});
`;

export const SLOW_SERVER = `
process.stdin.setEncoding("utf8");
let buf="";
function reply(id, result){ process.stdout.write(JSON.stringify({ jsonrpc:"2.0", id, result })+"\\n"); }
function handle(m){
  if(m.method==="server/discover") reply(m.id,{protocolVersion:"2026-07-28",capabilities:{}});
  else if(m.method==="tools/list") reply(m.id,{tools:[{name:"slow",description:"Slow",inputSchema:{type:"object",properties:{text:{type:"string"}}}}]});
  else if(m.method==="tools/call") setTimeout(()=>reply(m.id,{content:[{type:"text",text:m.params.arguments.text}]}), 8000);
}
process.stdin.on("data",c=>{buf+=c; for(;;){const i=buf.indexOf("\\n"); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(line.trim()!=="") handle(JSON.parse(line));}});
`;
