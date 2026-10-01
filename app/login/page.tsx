import { LoginForm } from "@/components/auth/login-form";
import { safeReturnPath } from "@/lib/auth/password-policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const returnTo = safeReturnPath((await searchParams).return_to);
  return (
    <main className="centered-page">
      <section className="quiet-card onboarding-card login-card" aria-labelledby="login-title">
        <div className="onboarding-brand">知临中学</div>
        <h1 id="login-title">登录</h1>
        <LoginForm returnTo={returnTo} />
        <div className="login-divider">
          <span>或</span>
        </div>
        <form
          action={`/api/auth/chatgpt?return_to=${encodeURIComponent(returnTo)}`}
          method="post"
          target="_top"
          noValidate
        >
          <button type="submit" className="button button--ghost login-provider-button">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M5 4h14v12H9l-4 4V4Z" />
            </svg>
            使用 ChatGPT 登录
          </button>
        </form>
      </section>
    </main>
  );
}
