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
            >
                Github
            </a>
            <Link href="/changelog" style={{ color: 'inherit', textDecoration: 'none' }}>
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
