"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function HashScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const id = hash.replace("#", "");
      const element = document.getElementById(id);
      if (element) {
        setTimeout(() => {
          const top = element.getBoundingClientRect().top + window.pageYOffset - 100;
          window.scrollTo({ top, behavior: "smooth" });
        }, 100);
      }
    }
  }, [pathname]);

  return null;
}
