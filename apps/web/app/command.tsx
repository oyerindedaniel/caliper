import { DEFAULT_COMMANDS } from "@caliper/core/static";
import styles from "./page.module.css";

interface CommandItem {
    key: string;
    command: string;
}

export function CommandTable() {
    const commands: CommandItem[] = [
        { key: "Activate", command: DEFAULT_COMMANDS.activate },
        { key: "Freeze/Unfreeze", command: DEFAULT_COMMANDS.freeze === " " ? "Space" : DEFAULT_COMMANDS.freeze },
        { key: "Select Element", command: `${DEFAULT_COMMANDS.select} + Click` },
        { key: "Clear Selection", command: DEFAULT_COMMANDS.clear },
        { key: "Calculator: Top", command: DEFAULT_COMMANDS.calculator.top },
        { key: "Calculator: Right", command: DEFAULT_COMMANDS.calculator.right },
        { key: "Calculator: Bottom", command: DEFAULT_COMMANDS.calculator.bottom },
        { key: "Calculator: Left", command: DEFAULT_COMMANDS.calculator.left },
        { key: "Calculator: Distance", command: DEFAULT_COMMANDS.calculator.distance },
        { key: "Projection: Top", command: DEFAULT_COMMANDS.projection.top },
        { key: "Projection: Left", command: DEFAULT_COMMANDS.projection.left },
        { key: "Projection: Bottom", command: DEFAULT_COMMANDS.projection.bottom },
        { key: "Projection: Right", command: DEFAULT_COMMANDS.projection.right },
        { key: "Viewport Ruler", command: `Shift + ${DEFAULT_COMMANDS.ruler}` },
    ];

    return (
        <>
            <h2 className={`${styles.sectionHeader} ${styles.commandsHeader}`}>
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
                        <tr key={item.key}>
                            <td>{item.key}</td>
                            <td>
                                <pre>{item.command}</pre>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}
