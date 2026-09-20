import { haojieApi } from "@/lib/haojie/api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => haojieApi(request, "list");
export const POST = (request: Request) => haojieApi(request, "create");
