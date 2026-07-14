export function requireUserId(request:Request):string{const id=request.headers.get("x-user-id");if(!id)throw new Error("X-User-ID required");return id;}
