import Link from "next/link";

export default function NotFound() {
  return (
    <section className="route-error-page">
      <div className="quiet-card route-error-card">
        <span className="eyebrow">404</span>
        <h1>页面不存在</h1>
        <p>这个地址可能已经失效，或对应内容不再可见。</p>
        <div className="route-error-actions"><Link className="button button--primary" href="/">返回首页</Link></div>
      </div>
    </section>
  );
}
