/* eslint-disable @next/next/no-img-element -- authenticated R2 assets use an application route */
type AvatarProps = {
  name: string;
  assetId?: string | null;
  size?: "small" | "medium" | "large";
};

export function Avatar({ name, assetId, size = "medium" }: AvatarProps) {
  const label = Array.from(name.trim())[0] ?? "知";
  if (assetId) {
    return <img className={`avatar avatar--${size}`} src={`/api/assets/${assetId}`} alt={`${name}的头像`} />;
  }
  return <span className={`avatar avatar--${size} avatar--fallback`} aria-label={`${name}的头像`}>{label}</span>;
}
