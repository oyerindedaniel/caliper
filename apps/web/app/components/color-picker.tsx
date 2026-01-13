"use client";

import { HexColorPicker } from "react-colorful";
import * as Popover from "@radix-ui/react-popover";
import styles from "../page.module.css";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label: string;
}

/**
 * Helper to convert various color formats to hex for the picker
 */
const toHex = (color: string): string => {
  if (color.startsWith("#")) return color;
  if (color.startsWith("rgba") || color.startsWith("rgb")) {
    const values = color.match(/\d+(\.\d+)?/g);
    if (!values || values.length < 3) return "#18A0FB";
    const r = parseInt(values[0]!);
    const g = parseInt(values[1]!);
    const b = parseInt(values[2]!);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
  }
  return "#18A0FB";
};

export const ColorPicker = ({ color, onChange, label }: ColorPickerProps) => {
  const hexValue = toHex(color);

  return (
    <div className={styles.configControl}>
      <label className={styles.configLabel}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className={styles.colorSwatch}
              style={{
                backgroundColor: color,
                cursor: "pointer",
                border: "1px solid #333",
                width: "30px",
                height: "30px",
                borderRadius: "4px",
                padding: 0,
              }}
              aria-label={`Pick color for ${label}`}
            />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={5}
              style={{
                zIndex: 1000,
                boxShadow:
                  "0px 10px 38px -10px rgba(22, 23, 24, 0.35), 0px 10px 20px -15px rgba(22, 23, 24, 0.2)",
                borderRadius: "8px",
                padding: "8px",
                backgroundColor: "#111",
                border: "1px solid #333",
              }}
            >
              <HexColorPicker color={hexValue} onChange={onChange} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <input
          type="text"
          className={`${styles.configInput} ${styles.colorInput}`}
          value={hexValue}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
};
