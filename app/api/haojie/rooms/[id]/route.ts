import { haojieApi } from "@/lib/haojie/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return haojieApi(request, "read", (await context.params).id);
}
