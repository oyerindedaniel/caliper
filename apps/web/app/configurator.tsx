import { useState, useMemo } from "react";
import styles from "./page.module.css";
import { useFocus } from "./context";
import { useCopy } from "./hooks/use-copy";
import { useConfig, type CommandConfig } from "./config-context";
import { ColorPicker } from "./components/color-picker";

const ShortcutField = ({
    label,
    value,
    id,
    isDuplicate,
    onUpdate
}: {
    label: string;
    value: string;
    id: keyof CommandConfig;
    isDuplicate: boolean;
    onUpdate: (id: keyof CommandConfig, value: string) => void;
}) => {
    const { registerInput } = useFocus();

    return (
        <div className={styles.configControl}>
            <label className={styles.configLabel}>{label}</label>
            <div style={{ position: 'relative', width: '100%' }}>
                <input
                    ref={(el) => registerInput(id, el)}
                    type="text"
                    className={`${styles.configInput} ${isDuplicate ? styles.inputError : ""}`}
                    style={{
                        ...(isDuplicate ? { borderColor: '#ef4444', color: '#ef4444' } : {}),
                        width: '100%'
                    }}
                    value={value === " " ? "Space" : value}
                    onChange={(e) => onUpdate(id, e.target.value === "Space" ? " " : e.target.value)}
                    placeholder="Key"
                />
                {isDuplicate && (
                    <span title="Duplicate check: Core commands must be unique. Contextual commands (Calculator vs Projection) can share keys." style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '10px',
                        color: '#ef4444',
                        fontWeight: 'bold',
                        cursor: 'help'
                    }}>!</span>
                )}
            </div>
        </div>
    );
};

export function Configurator() {
    const { copied, copy } = useCopy();
    const [tried, setTried] = useState(false);
    const { commands, updateCommand, theme, updateTheme, resetConfig } = useConfig();

    const conflicts = useMemo(() => {
        const errorIds = new Set<string>();
        const normalize = (v: string) => v.toLowerCase();

        // 1. Core/Global keys (activate, freeze, clear, select) MUST be unique globally.
        const coreKeys = ["activate", "freeze", "clear", "select"];
        coreKeys.forEach(id1 => {
            const val1 = normalize(commands[id1 as keyof typeof commands]);
            if (!val1) return;

            Object.entries(commands).forEach(([id2, val2]) => {
                if (id1 === id2) return;
                if (val1 === normalize(val2)) {
                    errorIds.add(id1);
                    errorIds.add(id2);
                }
            });
        });

        // 2. Calculator Group MUST be unique within itself
        const calcKeys = ["calcTop", "calcRight", "calcBottom", "calcLeft", "calcDist"];
        calcKeys.forEach(id1 => {
            const val1 = normalize(commands[id1 as keyof typeof commands]);
            if (!val1) return;
            calcKeys.forEach(id2 => {
                if (id1 === id2) return;
                if (val1 === normalize(commands[id2 as keyof typeof commands])) {
                    errorIds.add(id1);
                    errorIds.add(id2);
                }
            });
        });

        // 3. Projection Group MUST be unique within itself
        const projKeys = ["projTop", "projRight", "projBottom", "projLeft"];
        projKeys.forEach(id1 => {
            const val1 = normalize(commands[id1 as keyof typeof commands]);
            if (!val1) return;
            projKeys.forEach(id2 => {
                if (id1 === id2) return;
                if (val1 === normalize(commands[id2 as keyof typeof commands])) {
                    errorIds.add(id1);
                    errorIds.add(id2);
                }
            });
        });

        // Note: ruler is Shift+based, so it overlaps fine. 
        // Note: Calculator and Projection groups overlap fine per user request.

        return errorIds;
    }, [commands]);

    const hasErrors = conflicts.size > 0;

    const handleCopy = () => {
        if (hasErrors) return;

        const json = JSON.stringify({
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
                }
            }
        }, null, 2);

        copy(json);
    };

    const handleTryItOut = () => {
        setTried(true);
        setTimeout(() => {
            setTried(false)
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 1500);
    };

    const update = (key: keyof CommandConfig, value: string) => {
        updateCommand(key, value);
    };

    return (
        <section className={styles.section}>
            <h2 className={styles.sectionHeader}>Shortcut Configurator</h2>
            <p className={styles.instructionItem} style={{ marginBottom: '12px', opacity: 0.6, fontSize: '13px' }}>
                Customize your workflow. Keybindings are local to this generator.
                <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: 'var(--caliper-primary)' }}>
                    Tip: Calculator and Projection modes are state-exclusive, so they can safely share keys (like "D").
                </span>
            </p>

            <div className={styles.subHeader}>Core Commands</div>
            <div className={styles.configuratorGrid}>
                <ShortcutField label="Activate Overlay" value={commands.activate} id="activate" isDuplicate={conflicts.has("activate")} onUpdate={update} />
                <ShortcutField label="Freeze System" value={commands.freeze} id="freeze" isDuplicate={conflicts.has("freeze")} onUpdate={update} />
                <ShortcutField label="Deep Select" value={commands.select} id="select" isDuplicate={conflicts.has("select")} onUpdate={update} />
                <ShortcutField label="Clear All" value={commands.clear} id="clear" isDuplicate={conflicts.has("clear")} onUpdate={update} />
                <ShortcutField label="Ruler (Shift+)" value={commands.ruler} id="ruler" isDuplicate={conflicts.has("ruler")} onUpdate={update} />
            </div>

            <div className={styles.subHeader}>Calculator Triggers</div>
            <div className={styles.configuratorGrid}>
                <ShortcutField label="Top Edge" value={commands.calcTop} id="calcTop" isDuplicate={conflicts.has("calcTop")} onUpdate={update} />
                <ShortcutField label="Right Edge" value={commands.calcRight} id="calcRight" isDuplicate={conflicts.has("calcRight")} onUpdate={update} />
                <ShortcutField label="Bottom Edge" value={commands.calcBottom} id="calcBottom" isDuplicate={conflicts.has("calcBottom")} onUpdate={update} />
                <ShortcutField label="Left Edge" value={commands.calcLeft} id="calcLeft" isDuplicate={conflicts.has("calcLeft")} onUpdate={update} />
                <ShortcutField label="Side-to-Side" value={commands.calcDist} id="calcDist" isDuplicate={conflicts.has("calcDist")} onUpdate={update} />
            </div>

            <div className={styles.subHeader}>Projection Alignment</div>
            <div className={styles.configuratorGrid}>
                <ShortcutField label="Project Up" value={commands.projTop} id="projTop" isDuplicate={conflicts.has("projTop")} onUpdate={update} />
                <ShortcutField label="Project Right" value={commands.projRight} id="projRight" isDuplicate={conflicts.has("projRight")} onUpdate={update} />
                <ShortcutField label="Project Down" value={commands.projBottom} id="projBottom" isDuplicate={conflicts.has("projBottom")} onUpdate={update} />
                <ShortcutField label="Project Left" value={commands.projLeft} id="projLeft" isDuplicate={conflicts.has("projLeft")} onUpdate={update} />
            </div>

            <div className={styles.subHeader}>Color Configuration</div>
            <div className={styles.configuratorGrid}>
                <ColorPicker label="Primary" color={theme.primary} onChange={(v) => updateTheme("primary", v)} />
                <ColorPicker label="Secondary" color={theme.secondary} onChange={(v) => updateTheme("secondary", v)} />
                <ColorPicker label="Text" color={theme.text} onChange={(v) => updateTheme("text", v)} />
                <ColorPicker label="Calc Background" color={theme.calcBg} onChange={(v) => updateTheme("calcBg", v)} />
                <ColorPicker label="Calc Text" color={theme.calcText} onChange={(v) => updateTheme("calcText", v)} />
                <ColorPicker label="Calc Highlight" color={theme.calcOpHighlight} onChange={(v) => updateTheme("calcOpHighlight", v)} />
                <ColorPicker label="Projection" color={theme.projection} onChange={(v) => updateTheme("projection", v)} />
                <ColorPicker label="Ruler" color={theme.ruler} onChange={(v) => updateTheme("ruler", v)} />
            </div>

            <div className={styles.configAction} style={{ alignItems: 'center', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
                    <button
                        className={`${styles.btnBase} ${styles.btnPrimary}`}
                        onClick={handleCopy}
                        disabled={hasErrors}
                    >
                        {hasErrors ? "Fix Conflicts" : "Copy Config"}
                    </button>

                    <button
                        className={`${styles.btnBase} ${styles.btnSecondary}`}
                        onClick={resetConfig}
                    >
                        Reset Defaults
                    </button>

                    <button
                        className={`${styles.btnBase} ${styles.btnSecondary}`}
                        onClick={handleTryItOut}
                    >
                        Try It Out
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '12px', minHeight: '20px' }}>
                    <span className={`${styles.statusMessage} ${copied ? styles.statusVisible : ""}`}>
                        Copied! 📋
                    </span>
                    <span className={`${styles.statusMessage} ${tried ? styles.statusVisible : ""}`}>
                        {commands.activate} to inspect! ⚡
                    </span>
                </div>
            </div>

            {hasErrors && (
                <p style={{ color: '#ef4444', fontSize: '12px', fontWeight: '500', marginTop: '12px' }}>
                    ⚠️ Core commands must use unique keys. Check the highlighted fields.
                </p>
            )}
        </section >
    );
}
