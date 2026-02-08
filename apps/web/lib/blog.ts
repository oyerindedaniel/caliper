import path from "path";
import fs from "fs/promises";
import matter from "gray-matter";

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  author: string;
  coverImage: string;
  excerpt: string;
  content: string;
}

export interface BlogMeta {
  slug: string;
  title: string;
  date: string;
  author: string;
  coverImage: string;
  excerpt: string;
}

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export async function getAllBlogPosts(): Promise<BlogMeta[]> {
  try {
    const files = await fs.readdir(BLOG_DIR);
    const mdxFiles = files.filter((f) => f.endsWith(".mdx"));

    const posts = await Promise.all(
      mdxFiles.map(async (filename) => {
        const filePath = path.join(BLOG_DIR, filename);
        const source = await fs.readFile(filePath, "utf-8");
        const { data } = matter(source);

        return {
          slug: filename.replace(".mdx", ""),
          title: data.title || "Untitled",
          date: data.date || "",
          author: data.author || "Unknown",
          coverImage: data.coverImage || "",
          excerpt: data.excerpt || "",
        } as BlogMeta;
      })
    );

    return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (err) {
    console.error("Failed to read blog posts:", err);
    return [];
  }
}

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  try {
    const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
    const source = await fs.readFile(filePath, "utf-8");
    const { data, content } = matter(source);

    return {
      slug,
      title: data.title || "Untitled",
      date: data.date || "",
      author: data.author || "Unknown",
      coverImage: data.coverImage || "",
      excerpt: data.excerpt || "",
      content,
    };
  } catch (err) {
    console.error(`Failed to read blog post: ${slug}`, err);
    return null;
  }
}

export async function getAllBlogSlugs(): Promise<string[]> {
  try {
    const files = await fs.readdir(BLOG_DIR);
    return files.filter((f) => f.endsWith(".mdx")).map((f) => f.replace(".mdx", ""));
  } catch (err) {
    console.error("Failed to read blog slugs:", err);
    return [];
  }
}
