import { haojieApi } from "@/lib/haojie/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return haojieApi(request, "command", (await context.params).id);
}
