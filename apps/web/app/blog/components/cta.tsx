import Link from "next/link";
import styles from "../../page.module.css";

interface CTAProps {
  href: string;
  children: React.ReactNode;
}

export function CTA({ href, children }: CTAProps) {
  return (
    <div className={styles.blogCTAContainer}>
      <Link href={href} className={styles.blogCTA}>
        {children}
      </Link>
    </div>
  );
}
