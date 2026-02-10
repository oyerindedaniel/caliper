"use client";

import Image from "next/image";
import Link from "next/link";
import styles from "@/app/page.module.css";

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  coverImage: string;
}

interface BlogListProps {
  posts: BlogPost[];
}

export default function BlogList({ posts }: BlogListProps) {
  return (
    <div className={styles.blogGrid}>
      {posts.map((post) => (
        <Link key={post.slug} href={`/blog/${post.slug}`} className={styles.blogCard}>
          <div className={styles.blogImageContainer}>
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              placeholder="blur"
            />
          </div>
          <div className={styles.blogMeta}>
            <span className={styles.blogDate}>{post.date}</span>
            <h2 className={styles.blogTitle}>{post.title}</h2>
          </div>
        </Link>
      ))}
    </div>
  );
}
