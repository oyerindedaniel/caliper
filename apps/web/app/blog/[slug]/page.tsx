import { type Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, getAllBlogSlugs } from "@/lib/blog";
import { MDXRemote } from "next-mdx-remote/rsc";
import {
  MarginCollapseDemo,
  AgentReasoningDemo,
  CTA,
  FlexStretchDemo,
  HashScroll,
  BuiltBy,
} from "../components";
import styles from "@/app/page.module.css";
import Image from "next/image";
import { ComponentPropsWithoutRef, Suspense } from "react";

interface BlogPostProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateStaticParams() {
  const slugs = await getAllBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: BlogPostProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) return {};

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      url: `/blog/${slug}`,
      siteName: "Caliper",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      creator: "@fybnow",
    },
  };
}

const components = {
  MarginCollapseDemo,
  FlexStretchDemo,
  AgentReasoningDemo,
  CTA,
  BuiltBy,
  Logo: () => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontWeight: 600,
        color: "var(--foreground)",
        verticalAlign: "middle",
      }}
    >
      <Image src="/favicon.png" alt="Caliper Logo" width={18} height={18} className="rounded-sm" />
      Caliper
    </span>
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => {
    const id = props.children
      ?.toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "");
    return (
      <h2 {...props} id={id}>
        <a href={`#${id}`} className={styles.headerAnchor}>
          {props.children}
        </a>
      </h2>
    );
  },
  h3: (props: ComponentPropsWithoutRef<"h3">) => <h3 {...props} />,
  p: (props: ComponentPropsWithoutRef<"p">) => <p {...props} />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul {...props} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol {...props} />,
  li: (props: ComponentPropsWithoutRef<"li">) => <li {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => <blockquote {...props} />,
  hr: (props: ComponentPropsWithoutRef<"hr">) => <hr {...props} />,
};

export default async function BlogPostPage({ params }: BlogPostProps) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  return (
    <article className={styles.blogPostContainer} data-caliper-ignore>
      <div className="mb-32">
        <Link href="/blog" className={styles.link}>
          ← Back to Blog
        </Link>
      </div>
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
              placeholder="blur"
            />
          </div>
        )}
      </header>

      <div className={styles.mdxContent}>
        <MDXRemote source={post.content} components={components} />
      </div>
      <Suspense fallback={null}>
        <HashScroll />
      </Suspense>
    </article>
  );
}
