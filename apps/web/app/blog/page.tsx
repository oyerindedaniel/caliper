import { getAllBlogPosts } from "../../lib/blog";
import BlogList from "./blog-list";
import styles from "../page.module.css";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "Writing on design engineering, browser precision, and technical auditing.",
};

export default async function BlogPage() {
  const posts = await getAllBlogPosts();

  return (
    <div data-caliper-ignore>
      <header className="mb-48">
        <h1 className={styles.pageTitle}>Blog</h1>
        <p className="op-8" style={{ maxWidth: "500px" }}>
          Explorations in high-fidelity design engineering, layout auditing mechanics, and the
          pursuit of the perfect pixel.
        </p>
      </header>

      <BlogList posts={posts} />
    </div>
  );
}
