import { compareDemo } from "../../../lib/engine";
import { parseConfig } from "../../../lib/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
    parseConfig(body?.baseline, "Baseline");
    parseConfig(body?.candidate, "Candidate");
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Invalid JSON request",
      },
      { status: 400 },
    );
  }
  try {
    return Response.json(compareDemo(body));
  } catch {
    return Response.json(
      { error: "Unable to replay the historical demo. Please try again." },
      { status: 500 },
    );
  }
}
