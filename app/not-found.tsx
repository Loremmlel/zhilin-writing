import Link from "next/link";

export default function NotFound() {
  return (
    <section className="route-error-page">
      <div className="quiet-card route-error-card">
        <span className="eyebrow">404</span>
        <h1>页面不存在</h1>
        <p>没有找到这个页面。请检查地址，或返回首页继续浏览。</p>
        <div className="route-error-actions"><Link className="button button--primary" href="/">返回首页</Link></div>
      </div>
    </section>
  );
}
