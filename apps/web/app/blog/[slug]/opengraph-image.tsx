import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBlogPost } from "@/lib/blog";
import { BASE_URL } from "../../constants";

export const runtime = "nodejs";

export const alt = "Caliper Blog Post";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    return new Response("Not Found", { status: 404 });
  }

  const geistSansData = await readFile(join(process.cwd(), "app/fonts/Geist-Regular.ttf"));

  const imageUrl = post.coverImage.startsWith("http")
    ? post.coverImage
    : `${BASE_URL}${post.coverImage}`;

  const primaryColor = "#18a0fb";

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#050505",
        position: "relative",
        fontFamily: "Geist Sans",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "450px",
          width: "100%",
          overflow: "hidden",
        }}
      >
        <img
          src={imageUrl}
          alt={post.title}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.6,
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(135deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.6) 100%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 40,
            left: 60,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <img src={`${BASE_URL}/favicon.png`} width="32" height="32" style={{ borderRadius: 6 }} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 8 }}>
            <span
              style={{ fontSize: 20, fontWeight: 600, color: "white", letterSpacing: "-0.01em" }}
            >
              Caliper
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: primaryColor,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginTop: -2,
              }}
            >
              Design Engineering
            </span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: primaryColor,
            boxShadow: `0 0 20px ${primaryColor}44`,
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 60,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: primaryColor }}>{post.date}</span>
          <div
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: "rgba(255,255,255,0.3)",
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>
            {post.author}
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          padding: "0 60px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 800,
            color: "white",
            lineHeight: 1.1,
            letterSpacing: "-0.04em",
            maxWidth: "100%",
          }}
        >
          {post.title}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Geist Sans",
          data: geistSansData,
          weight: 600,
          style: "normal",
        },
      ],
    }
  );
}
