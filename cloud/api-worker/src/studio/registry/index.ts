import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env,Variables } from '../../server/types';
import { requireUser } from '../../identity/requireUser';
import { forwardToWorker,mirrorResponse } from '../../proxy/forward';
export const registryRoutes=new Hono<{Bindings:Env;Variables:Variables}>();
registryRoutes.all('/*',requireUser,async c=>forward(c,`/${c.req.param('*')}`));
async function forward(c:Context<{Bindings:Env;Variables:Variables}>,path:string){const body=['GET','HEAD'].includes(c.req.method)?null:await c.req.raw.clone().arrayBuffer();return mirrorResponse(await forwardToWorker(c.env.REGISTRY,path,{userId:c.get('caller').sub,method:c.req.method,contentType:c.req.header('Content-Type'),body,search:new URL(c.req.url).search}));}
