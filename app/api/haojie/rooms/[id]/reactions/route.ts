import { haojieApi } from "@/lib/haojie/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return haojieApi(request, "reaction", (await context.params).id);
}
