import styles from "./page.module.css";
import { useFocus } from "./context";
import { useOS } from "./hooks/use-os";

interface CommandItem {
    key: string;
    command: string;
    configId?: string;
}

export function CommandTable() {
    const { focusInput } = useFocus();
    const { getControlKey } = useOS();

    const commands: CommandItem[] = [
        { key: "Activate", command: "Alt", configId: "activate" },
        { key: "Freeze/Unfreeze", command: "Space", configId: "freeze" },
        { key: "Select Element", command: `${getControlKey()} + Hold + Click`, configId: "select" },
        { key: "Clear Selection", command: "Escape", configId: "clear" },
        { key: "Calculator: Top", command: "t", configId: "calcTop" },
        { key: "Calculator: Right", command: "r", configId: "calcRight" },
        { key: "Calculator: Bottom", command: "b", configId: "calcBottom" },
        { key: "Calculator: Left", command: "l", configId: "calcLeft" },
        { key: "Calculator: Distance", command: "d", configId: "calcDist" },
        { key: "Projection: Top", command: "w", configId: "projTop" },
        { key: "Projection: Left", command: "a", configId: "projLeft" },
        { key: "Projection: Bottom", command: "s", configId: "projBottom" },
        { key: "Projection: Right", command: "d", configId: "projRight" },
        { key: "Viewport Ruler", command: "Shift + r", configId: "ruler" },
        { key: "Chain Rulers", command: "Shift + Click" },
        { key: "Nudge Ruler", command: "Arrow Keys" },
    ];

    return (
        <section className={styles.section}>
            <h2 className={`${styles.sectionHeader}`}>
                Command Palette
            </h2>
            <table className={styles.commandTable}>
                <thead>
                    <tr>
                        <th>Action</th>
                        <th>Shortcut</th>
                    </tr>
                </thead>
                <tbody>
                    {commands.map((item) => (
                        <tr
                            key={item.key}
                            onClick={() => item.configId && focusInput(item.configId)}
                            style={{ cursor: item.configId ? 'pointer' : 'default' }}
                            className={item.configId ? styles.clickableRow : ""}
                        >
                            <td>{item.key}</td>
                            <td>
                                <pre>{item.command}</pre>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
