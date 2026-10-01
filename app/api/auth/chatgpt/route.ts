import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { safeReturnPath } from "@/lib/auth/password-policy";
import { clearPasswordSession } from "@/lib/auth/signout";
export const dynamic = "force-dynamic";
export const POST = (request: Request) =>
  clearPasswordSession(
    request,
    chatGPTSignInPath(safeReturnPath(new URL(request.url).searchParams.get("return_to"))),
  );
