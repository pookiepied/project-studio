import { spawn } from "child_process";
import { resolveRipgrep } from "../../shared/vendor.js";
import { scopedPaths, type SearchScope } from "./scope.js";

const EXCLUDES = ["!.git/**","!node_modules/**","!dist/**","!build/**","!coverage/**","!.next/**","!out/**","!vendor/**","!**/*.min.js","!**/*.min.css","!**/*.generated.*","!**/*_generated.*"];
export interface SearchOptions { query:string; root:string; mode?:"literal"|"regex"; caseSensitive?:boolean; wholeWord?:boolean; include?:string[]; exclude?:string[]; fileTypes?:string[]; includeGenerated?:boolean; scope?:SearchScope; baseRef?:string; maxResults?:number; maxResultsPerFile?:number; maxOutputBytes?:number; countOnly?:boolean }
export async function runSearch(options: SearchOptions): Promise<Record<string, unknown>> {
  const paths = await scopedPaths(options.root, options.scope ?? "workspace", options.baseRef);
  if (paths?.length === 0) return { matches: [], total_matches: 0, matching_files: 0, truncated: false, scope: options.scope };
  const args = ["--json", "--line-number", "--column", "--no-heading"];
  if (options.mode !== "regex") args.push("--fixed-strings"); if (options.caseSensitive === false) args.push("--ignore-case"); if (options.wholeWord) args.push("--word-regexp");
  for (const type of options.fileTypes ?? []) args.push("--type", type);
  for (const glob of options.include ?? []) args.push("--glob", glob);
  for (const glob of options.exclude ?? []) args.push("--glob", `!${glob}`);
  if (!options.includeGenerated) for (const glob of EXCLUDES) args.push("--glob", glob);
  args.push(options.query); if (paths) args.push(...paths); else args.push(options.root);
  const max = Math.min(options.maxResults ?? 250, 10_000), perFile = Math.min(options.maxResultsPerFile ?? max, max), byteLimit = Math.min(options.maxOutputBytes ?? 512_000, 5_000_000);
  return await new Promise(resolve => {
    const proc = spawn(resolveRipgrep(), args, { cwd: options.root, stdio: ["ignore","pipe","pipe"] }); let pending="", stderr="", bytes=0, truncated=false, settled=false;
    const matches:any[]=[]; const counts=new Map<string,number>(), returnedCounts=new Map<string,number>(); let totalMatches=0;
    const finish=(error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);const summary={matches,total_matches:options.countOnly?totalMatches:matches.length,matches_observed:totalMatches,matching_files:counts.size,truncated,scope:options.scope??"workspace"};resolve(error?{error,...summary}:summary);};
    const consume=(line:string)=>{if(!line)return;let event:any;try{event=JSON.parse(line)}catch{return}if(event.type!=="match")return;const d=event.data,path=d.path?.text??"";totalMatches+=(d.submatches?.length||1);counts.set(path,(counts.get(path)??0)+(d.submatches?.length||1));if(options.countOnly)return;const prior=returnedCounts.get(path)??0;if(prior>=perFile)return;const sub=d.submatches?.[0];const item={path,line:d.line_number,column:(sub?.start??0)+1,matched_text:sub?.match?.text??"",line_text:String(d.lines?.text??"").replace(/\r?\n$/,"")};const size=Buffer.byteLength(JSON.stringify(item));if(matches.length>=max||bytes+size>byteLimit){truncated=true;proc.kill();return}matches.push(item);returnedCounts.set(path,prior+1);bytes+=size;};
    proc.stdout.on("data",chunk=>{pending+=chunk.toString();const lines=pending.split(/\r?\n/);pending=lines.pop()??"";for(const line of lines)consume(line)});proc.stderr.on("data",d=>stderr+=d.toString());
    proc.on("close",code=>{consume(pending);if(code && code>1 && !truncated)finish(stderr.trim()||`ripgrep exited ${code}`);else finish()});proc.on("error",e=>finish(e.message));
    const timer=setTimeout(()=>{truncated=true;proc.kill();finish("Search timed out after 30 seconds; narrow its scope or filters.")},30_000);
  });
}
