export const metadata = { title: "访问受限" };

export default function AccessDeniedPage() {
  return (
    <main className="centered-page">
      <div className="quiet-card">
        <span className="eyebrow">受邀请访问</span>
        <h1>这个写作社区暂未向你开放</h1>
        <p>知临中学只对管理员邀请的成员开放。</p>
        <form action="/api/auth/logout" method="post" target="_top" noValidate>
          <button type="submit" className="button button--ghost">
            退出并重新登录
          </button>
        </form>
      </div>
    </main>
  );
}
