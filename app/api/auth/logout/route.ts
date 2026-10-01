import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { clearPasswordSession } from "@/lib/auth/signout";
export const dynamic = "force-dynamic";
export const POST = (request: Request) =>
  clearPasswordSession(request, chatGPTSignOutPath("/login"));
