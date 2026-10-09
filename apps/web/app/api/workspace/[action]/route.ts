import { workspaceGet, workspacePost } from "../../../../lib/workspace-api";
export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ action: string }> };
export async function GET(_request: Request, context: Context) {
  return workspaceGet((await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return workspacePost((await context.params).action, request);
}
