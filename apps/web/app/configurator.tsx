import { useState, useMemo, useRef } from "react";
import styles from "./page.module.css";
import { useFocus } from "./focus-context";
import { useCopy } from "./hooks/use-copy";
import { useKeyCapture } from "./hooks/use-key-capture";
import { useConfig, type CommandConfig } from "./config-context";
import { ColorPicker } from "./components/color-picker";

const ShortcutField = ({
  label,
  value,
  id,
  isDuplicate,
  onUpdate,
}: {
  label: string;
  value: string;
  id: keyof CommandConfig;
  isDuplicate: boolean;
  onUpdate: (id: keyof CommandConfig, value: string) => void;
}) => {
  const { registerInput } = useFocus();
  const inputRef = useRef<HTMLInputElement>(null);

  const { isRecording, startRecording, stopRecording, handleKeyDown } = useKeyCapture(
    (key) => {
      onUpdate(id, key);
      inputRef.current?.blur();
    },
    () => {
      inputRef.current?.blur();
    }
  );

  const displayValue = useMemo(() => {
    if (isRecording) return "Recording...";

    // Mapping for common keys
    const keyMap: Record<string, string> = {
      " ": "Space",
      Meta: "Cmd",
      Control: "Ctrl",
      AltGraph: "Alt",
      ArrowUp: "Up Arrow",
      ArrowDown: "Down Arrow",
      ArrowLeft: "Left Arrow",
      ArrowRight: "Right Arrow",
      Enter: "Return",
      Escape: "Esc",
    };

    if (value in keyMap) return keyMap[value];
    return value;
  }, [value, isRecording]);

  return (
    <div className={styles.configControl}>
      <label className={styles.configLabel}>{label}</label>
      <div style={{ position: "relative", width: "100%" }}>
        <input
          ref={(el) => {
            registerInput(id, el);
            inputRef.current = el;
          }}
          type="text"
          readOnly
          className={`${styles.configInput} ${isDuplicate ? styles.inputError : ""} ${isRecording ? styles.configInputRecording : ""}`}
          style={{
            ...(isDuplicate ? { borderColor: "#ef4444", color: "#ef4444" } : {}),
            width: "100%",
            cursor: "pointer",
            caretColor: "transparent",
          }}
          value={displayValue}
          onFocus={startRecording}
          onBlur={stopRecording}
          onKeyDown={handleKeyDown}
          placeholder="Click to configure"
        />
        {isDuplicate && (
          <span
            title="Duplicate check: All shortcuts must be globally unique (excluding Ruler)."
            className={styles.duplicateIndicator}
          >
            !
          </span>
        )}
        <div className={styles.recordIndicator}>
          {isRecording ? "Listening..." : "Click to edit"}
        </div>
      </div>
    </div>
  );
};

export function Configurator() {
  const { copy } = useCopy();
  const [status, setStatus] = useState<"copied" | "tried" | null>(null);
  const { commands, updateCommand, theme, updateTheme, resetConfig, applyConfig } = useConfig();

  const conflicts = useMemo(() => {
    const errorIds = new Set<string>();
    const normalize = (v: string) => v;

    const allKeys = Object.keys(commands);

    allKeys.forEach((id1) => {
      if (id1 === "ruler") return;
      const val1 = normalize(commands[id1 as keyof typeof commands]);
      if (!val1) return;

      allKeys.forEach((id2) => {
        if (id1 === id2 || id2 === "ruler") return;
        const val2 = normalize(commands[id2 as keyof typeof commands]);
        if (val1 === val2) {
          errorIds.add(id1);
          errorIds.add(id2);
        }
      });
    });

    return errorIds;
  }, [commands]);

  const hasErrors = conflicts.size > 0;

  const handleCopy = async () => {
    if (hasErrors) return;

    const json = JSON.stringify(
      {
        commands: {
          activate: commands.activate,
          freeze: commands.freeze,
          select: commands.select,
          clear: commands.clear,
          ruler: commands.ruler,
          calculator: {
            top: commands.calcTop,
            right: commands.calcRight,
            bottom: commands.calcBottom,
            left: commands.calcLeft,
            distance: commands.calcDist,
          },
          projection: {
            top: commands.projTop,
            right: commands.projRight,
            bottom: commands.projBottom,
            left: commands.projLeft,
          },
        },
      },
      null,
      2
    );

    const success = await copy(json);
    if (success) {
      setStatus("copied");
      setTimeout(() => setStatus(null), 2000);
    }
  };

  const handleTryItOut = () => {
    applyConfig();
    setStatus("tried");
    setTimeout(() => {
      setStatus(null);
      // window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 2500);
  };

  const update = (key: keyof CommandConfig, value: string) => {
    updateCommand(key, value);
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeader}>Shortcut Configurator</h2>
      <p
        className={styles.instructionItem}
        style={{ marginBottom: "12px", opacity: 0.6, fontSize: "13px" }}
      >
        Customize your workflow. Keybindings are local to this generator.
        <span
          style={{
            display: "block",
            marginTop: "4px",
            fontSize: "11px",
            color: "var(--caliper-primary)",
          }}
        >
          Tip: All shortcuts must be globally unique to prevent control conflicts.
        </span>
      </p>

      <div className={styles.subHeader}>Core Commands</div>
      <div className={styles.configuratorGrid}>
        <ShortcutField
          label="Activate Overlay"
          value={commands.activate}
          id="activate"
          isDuplicate={conflicts.has("activate")}
          onUpdate={update}
        />
        <ShortcutField
          label="Freeze System"
          value={commands.freeze}
          id="freeze"
          isDuplicate={conflicts.has("freeze")}
          onUpdate={update}
        />
        <ShortcutField
          label="Deep Select"
          value={commands.select}
          id="select"
          isDuplicate={conflicts.has("select")}
          onUpdate={update}
        />
        <ShortcutField
          label="Clear All"
          value={commands.clear}
          id="clear"
          isDuplicate={conflicts.has("clear")}
          onUpdate={update}
        />
        <ShortcutField
          label="Ruler (Shift+)"
          value={commands.ruler.toLowerCase()}
          id="ruler"
          isDuplicate={conflicts.has("ruler")}
          onUpdate={update}
        />
      </div>

      <div className={styles.subHeader}>Calculator Triggers</div>
      <div className={styles.configuratorGrid}>
        <ShortcutField
          label="Top Edge"
          value={commands.calcTop}
          id="calcTop"
          isDuplicate={conflicts.has("calcTop")}
          onUpdate={update}
        />
        <ShortcutField
          label="Right Edge"
          value={commands.calcRight}
          id="calcRight"
          isDuplicate={conflicts.has("calcRight")}
          onUpdate={update}
        />
        <ShortcutField
          label="Bottom Edge"
          value={commands.calcBottom}
          id="calcBottom"
          isDuplicate={conflicts.has("calcBottom")}
          onUpdate={update}
        />
        <ShortcutField
          label="Left Edge"
          value={commands.calcLeft}
          id="calcLeft"
          isDuplicate={conflicts.has("calcLeft")}
          onUpdate={update}
        />
        <ShortcutField
          label="Side-to-Side"
          value={commands.calcDist}
          id="calcDist"
          isDuplicate={conflicts.has("calcDist")}
          onUpdate={update}
        />
      </div>

      <div className={styles.subHeader}>Projection Alignment</div>
      <div className={styles.configuratorGrid}>
        <ShortcutField
          label="Project Up"
          value={commands.projTop}
          id="projTop"
          isDuplicate={conflicts.has("projTop")}
          onUpdate={update}
        />
        <ShortcutField
          label="Project Right"
          value={commands.projRight}
          id="projRight"
          isDuplicate={conflicts.has("projRight")}
          onUpdate={update}
        />
        <ShortcutField
          label="Project Down"
          value={commands.projBottom}
          id="projBottom"
          isDuplicate={conflicts.has("projBottom")}
          onUpdate={update}
        />
        <ShortcutField
          label="Project Left"
          value={commands.projLeft}
          id="projLeft"
          isDuplicate={conflicts.has("projLeft")}
          onUpdate={update}
        />
      </div>

      <div className={styles.subHeader}>Color Configuration</div>
      <div className={styles.configuratorGrid}>
        <ColorPicker
          label="Primary"
          color={theme.primary}
          onChange={(v) => updateTheme("primary", v)}
        />
        <ColorPicker
          label="Secondary"
          color={theme.secondary}
          onChange={(v) => updateTheme("secondary", v)}
        />
        <ColorPicker label="Text" color={theme.text} onChange={(v) => updateTheme("text", v)} />
        <ColorPicker
          label="Calc Background"
          color={theme.calcBg}
          onChange={(v) => updateTheme("calcBg", v)}
        />
        <ColorPicker
          label="Calc Text"
          color={theme.calcText}
          onChange={(v) => updateTheme("calcText", v)}
        />
        <ColorPicker
          label="Calc Highlight"
          color={theme.calcOpHighlight}
          onChange={(v) => updateTheme("calcOpHighlight", v)}
        />
        <ColorPicker
          label="Projection"
          color={theme.projection}
          onChange={(v) => updateTheme("projection", v)}
        />
        <ColorPicker label="Ruler" color={theme.ruler} onChange={(v) => updateTheme("ruler", v)} />
      </div>

      <div className={styles.configAction} style={{ alignItems: "center", textAlign: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
          <button
            className={`${styles.btnBase} ${styles.btnPrimary}`}
            onClick={handleCopy}
            disabled={hasErrors}
          >
            {hasErrors ? "Fix Conflicts" : "Copy Config"}
          </button>

          <button className={`${styles.btnBase} ${styles.btnSecondary}`} onClick={resetConfig}>
            Reset Defaults
          </button>

          <button className={`${styles.btnBase} ${styles.btnSecondary}`} onClick={handleTryItOut}>
            Try It Out
          </button>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
          }}
        >
          <span
            className={`${styles.statusMessage} ${status === "copied" ? styles.statusVisible : ""}`}
          >
            Copied! 📋
          </span>
          <span
            className={`${styles.statusMessage} ${status === "tried" ? styles.statusVisible : ""}`}
            style={{ position: "absolute" }}
          >
            {commands.activate} to inspect! ⚡
          </span>
        </div>
      </div>

      {hasErrors && (
        <p
          style={{
            color: "#ef4444",
            fontSize: "12px",
            fontWeight: "500",
            marginTop: "12px",
            textAlign: "center",
          }}
        >
          ⚠️ Core commands must use unique keys. Check the highlighted fields.
        </p>
      )}
    </section>
  );
}
