import { handleMcpRequest } from "@/lib/mcp/protocol";
import { callMcpTool, getMcpWritingAccess } from "@/lib/mcp/service";
import { logServerError } from "@/lib/logging";

export const dynamic = "force-dynamic";

function handle(request: Request) {
  return handleMcpRequest(request, {
    access: getMcpWritingAccess,
    call: callMcpTool,
    report: (error) =>
      logServerError({ operation: "mcp.read", error, errorCode: "MCP_READ_FAILED" }),
  });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
