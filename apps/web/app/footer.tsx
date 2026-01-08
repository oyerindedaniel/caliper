import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";

export function Footer() {
    return (
        <footer className={styles.footer}>
            <a
                href="https://github.com/oyerindedaniel/caliper"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.githubLink}
            >
                <div className={styles.starWrapper}>
                    <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        className={styles.starIcon}
                    >
                        <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z" />
                    </svg>
                    <span>Github</span>
                </div>
            </a>
            <Link href="/changelog">
                Changelog
            </Link>
            <a
                href="https://danieloyerinde.com"
                target="_blank"
                rel="noopener noreferrer"
            >
                <Image
                    aria-hidden
                    src="/globe.svg"
                    alt="Globe icon"
                    width={16}
                    height={16}
                />
                Daniel Oyerinde →
            </a>
        </footer>
    );
}
