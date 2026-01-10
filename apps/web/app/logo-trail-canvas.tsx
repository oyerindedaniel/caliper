"use client";

import { useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  opacity: number;
}

const TRAIL_LENGTH = 25;
const TRAIL_FADE_SPEED = 0.015;
const TRAIL_RADIUS = 60;
const POINT_SPACING = 8;

export default function LogoTrailCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  const rafRef = useRef<number>(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isLoadedRef = useRef(false);

  const addTrailPoint = useCallback((x: number, y: number) => {
    const trail = trailRef.current;
    if (!trail) return;
    const last = lastPointRef.current;

    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < POINT_SPACING) return;
    }

    lastPointRef.current = { x, y };

    trail.push({
      x,
      y,
      age: 0,
      opacity: 1,
    });

    while (trail.length > TRAIL_LENGTH) {
      trail.shift();
    }
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const logoImage = logoImageRef.current;
    if (!canvas || !logoImage || !isLoadedRef.current) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const trail = trailRef.current;
    if (!trail) return;

    for (let i = trail.length - 1; i >= 0; i--) {
      const point = trail[i];
      if (!point) continue;

      point.age += 1;
      point.opacity -= TRAIL_FADE_SPEED;
      if (point.opacity <= 0) {
        trail.splice(i, 1);
      }
    }

    if (trail.length === 0) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    ctx.save();

    ctx.beginPath();
    for (const point of trail) {
      const radius = TRAIL_RADIUS * point.opacity;
      ctx.moveTo(point.x * dpr + radius, point.y * dpr);
      ctx.arc(point.x * dpr, point.y * dpr, radius, 0, Math.PI * 2);
    }
    ctx.clip();

    const logoW = logoImage.width;
    const logoH = logoImage.height;
    const logoAspect = logoW / logoH;

    const targetMaxWidth = w;
    const targetMaxHeight = h;

    let drawW = targetMaxWidth;
    let drawH = drawW / logoAspect;

    if (drawH < targetMaxHeight) {
      drawH = targetMaxHeight;
      drawW = drawH * logoAspect;
    }

    const drawX = (w - drawW) / 2;
    const drawY = (h - drawH) / 2;

    ctx.globalAlpha = 0.15;
    ctx.drawImage(logoImage, drawX * dpr, drawY * dpr, drawW * dpr, drawH * dpr);

    ctx.restore();

    rafRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.src = "/caliper_logo.svg";
    img.onload = () => {
      logoImageRef.current = img;
      isLoadedRef.current = true;
    };

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    const handlePointerMove = (e: PointerEvent) => {
      addTrailPoint(e.clientX, e.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    rafRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [addTrailPoint, render]);

  return (
    <canvas
      data-caliper-ignore
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        touchAction: "none",
        zIndex: 9999,
      }}
      aria-hidden="true"
    />
  );
}

export const LogoTrail = dynamic(() => import("./logo-trail-canvas"), { ssr: false });
