import { chatGPTSignOutPath } from "@/app/chatgpt-auth";

export default function AccessDeniedPage() {
  return (
    <main className="centered-page">
      <div className="quiet-card">
        <span className="eyebrow">受邀请访问</span>
        <h1>这个写作社区暂未向你开放</h1>
        <p>知临中学只对管理员邀请的少数成员开放。你的 ChatGPT 邮箱不会显示给其他成员。</p>
        <a className="button button--ghost" href={chatGPTSignOutPath("/")}>换一个 ChatGPT 账户</a>
      </div>
    </main>
  );
}
