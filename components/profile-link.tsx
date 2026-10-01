import Link from "next/link";
import type { ReactNode } from "react";

export function ProfileLink({
  userId,
  name,
  children,
  avatar = false,
}: {
  userId: string | null;
  name: string;
  children: ReactNode;
  avatar?: boolean;
}) {
  if (!userId) return <>{children}</>;
  return (
    <Link
      href={`/users/${userId}`}
      className={`profile-link${avatar ? " profile-link--avatar" : ""}`}
      aria-label={`查看${name}的个人主页`}
      title={`查看${name}的个人主页`}
    >
      {children}
    </Link>
  );
}
