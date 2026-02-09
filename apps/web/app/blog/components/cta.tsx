import Link from "next/link";
import styles from "@/app/page.module.css";

interface CTAProps {
  href: string;
  children: React.ReactNode;
}

export function CTA({ href, children }: CTAProps) {
  return (
    <div className={styles.blogCTAContainer}>
      <Link href={href} className={styles.blogCTA}>
        <span>{children}</span>
        <span
          className={`${styles.ctaIcon} material-symbols-outlined`}
          style={{ fontSize: "20px" }}
        >
          arrow_forward
        </span>
      </Link>
    </div>
  );
}
