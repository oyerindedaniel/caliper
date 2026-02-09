import { getAllBlogPosts } from "@/lib/blog";
import BlogList from "./blog-list";
import styles from "@/app/page.module.css";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "Technical logs on Caliper's layout engine, browser precision, and solving layout discrepancies.",
};

export default async function BlogPage() {
  const posts = await getAllBlogPosts();

  return (
    <div data-caliper-ignore>
      <header className="mb-48">
        <h1 className={styles.pageTitle}>Blog</h1>
        <p className="op-8">
          Technical logs on Caliper's layout engine, browser geometric edge cases, and the mechanics of browser precision.
        </p>
      </header>

      <BlogList posts={posts} />
    </div>
  );
}
