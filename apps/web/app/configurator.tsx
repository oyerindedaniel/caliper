import { useState, useMemo } from "react";
import styles from "./page.module.css";

const ShortcutField = ({
    label,
    value,
    id,
    isDuplicate,
    onUpdate
}: {
    label: string;
    value: string;
    id: string;
    isDuplicate: boolean;
    onUpdate: (id: string, value: string) => void;
}) => (
    <div className={styles.configControl}>
        <label className={styles.configLabel}>{label}</label>
        <div style={{ position: 'relative' }}>
            <input
                type="text"
                className={`${styles.configInput} ${isDuplicate ? styles.inputError : ""}`}
                style={isDuplicate ? { borderColor: '#ef4444', color: '#ef4444' } : {}}
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

export function Configurator() {
    const [commands, setCommands] = useState({
        activate: "Alt",
        freeze: " ",
        select: "Control",
        clear: "Escape",
        ruler: "r",
        calcTop: "t",
        calcRight: "r",
        calcBottom: "b",
        calcLeft: "l",
        calcDist: "d",
        projTop: "w",
        projRight: "d",
        projBottom: "s",
        projLeft: "a",
    });

    const [copied, setCopied] = useState(false);

    // Group-based validation logic
    const conflicts = useMemo(() => {
        const errorIds = new Set<string>();
        const normalize = (v: string) => v.toLowerCase();

        // 1. Core/Global keys (activate, freeze, clear, select) MUST be unique globally.
        const coreKeys = ["activate", "freeze", "clear", "select"];
        coreKeys.forEach(id1 => {
            const val1 = normalize(commands[id1 as keyof typeof commands]);
            if (!val1) return;

            // Check against all other fields
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

        navigator.clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const update = (key: string, value: string) => {
        setCommands(prev => ({ ...prev, [key]: value }));
    };

    return (
        <>
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

            <div className={styles.configAction}>
                {hasErrors && (
                    <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '8px', fontWeight: '500' }}>
                        ⚠️ Core commands must use unique keys. Check the highlighted fields.
                    </p>
                )}
                <button
                    className={styles.copyButton}
                    onClick={handleCopy}
                    disabled={hasErrors}
                    style={hasErrors ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                >
                    {hasErrors ? "Resolve Overlapping Shortcuts" : "Copy Custom Commands JSON"}
                </button>
                <span className={`${styles.copyStatus} ${copied ? styles.copyStatusVisible : ""}`}>
                    Ready to paste! 📋
                </span>
            </div>
        </>
    );
}
