import { notFound } from "next/navigation";
import { getBlogPost, getAllBlogSlugs } from "../../../lib/blog";
import { MDXRemote } from "next-mdx-remote/rsc";
import { MarginCollapseDemo, AgentReasoningDemo, AgentTrace, CTA } from "../components";
import styles from "../../page.module.css";
import Image from "next/image";

interface BlogPostProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateStaticParams() {
  const slugs = await getAllBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: BlogPostProps) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) return {};

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      images: [post.coverImage],
    },
  };
}

const components = {
  MarginCollapseDemo,
  AgentReasoningDemo,
  AgentTrace,
  CTA,
};

export default async function BlogPostPage({ params }: BlogPostProps) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  return (
    <article className={styles.blogPostContainer} data-caliper-ignore>
      <header className={styles.blogPostHeader}>
        <span className={styles.blogPostDate}>{post.date}</span>
        <h1 className={styles.blogPostTitle}>{post.title}</h1>
        {post.coverImage && (
          <div className={styles.blogPostImageContainer}>
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              className={styles.blogPostImage}
              priority
              unoptimized
            />
          </div>
        )}
      </header>

      <div className={styles.mdxContent}>
        <MDXRemote source={post.content} components={components} />
      </div>
    </article>
  );
}
