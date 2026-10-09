import { getDemo } from "../../../lib/engine";
export const runtime = "nodejs";
export function GET() {
  return Response.json(getDemo(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
