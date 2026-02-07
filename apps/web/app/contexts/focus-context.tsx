"use client";

import React, { createContext, useContext, useRef, useCallback } from "react";

interface FocusContextType {
  focusInput: (id: string) => void;
  registerInput: (id: string, ref: HTMLInputElement | null) => void;
}

const FocusContext = createContext<FocusContextType | null>(null);

export const FocusProvider = ({ children }: { children: React.ReactNode }) => {
  const inputRefs = useRef<Record<string, HTMLInputElement>>({});

  const registerInput = useCallback((id: string, ref: HTMLInputElement | null) => {
    if (ref) {
      inputRefs.current[id] = ref;
    } else {
      delete inputRefs.current[id];
    }
  }, []);

  const focusInput = useCallback((id: string) => {
    const input = inputRefs.current[id];
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  return (
    <FocusContext.Provider value={{ focusInput, registerInput }}>{children}</FocusContext.Provider>
  );
};

export const useFocus = () => {
  const context = useContext(FocusContext);
  if (!context) {
    throw new Error("useFocus must be used within a FocusProvider");
  }
  return context;
};
