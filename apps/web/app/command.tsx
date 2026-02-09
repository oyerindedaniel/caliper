import styles from "@/app/page.module.css";
import { useFocus } from "./contexts/focus-context";
import { useOS } from "./hooks/use-os";
import { useConfig, type CommandConfig } from "./contexts/config-context";

interface CommandItem {
  key: string;
  command: string;
  configId?: keyof CommandConfig;
}

export function CommandTable() {
  const { focusInput } = useFocus();
  const { getControlKey } = useOS();
  const { commands: config } = useConfig();

  const commands: CommandItem[] = [
    { key: "Activate", command: config.activate, configId: "activate" },
    {
      key: "Freeze/Unfreeze",
      command: config.freeze === " " ? "Space" : config.freeze,
      configId: "freeze",
    },
    { key: "Select Element", command: `${getControlKey()} + Click + Hold`, configId: "select" },
    { key: "Clear Selection", command: config.clear, configId: "clear" },
    { key: "Calculator: Top", command: config.calcTop, configId: "calcTop" },
    { key: "Calculator: Right", command: config.calcRight, configId: "calcRight" },
    { key: "Calculator: Bottom", command: config.calcBottom, configId: "calcBottom" },
    { key: "Calculator: Left", command: config.calcLeft, configId: "calcLeft" },
    { key: "Calculator: Distance", command: config.calcDist, configId: "calcDist" },
    { key: "Projection: Top", command: config.projTop, configId: "projTop" },
    { key: "Projection: Left", command: config.projLeft, configId: "projLeft" },
    { key: "Projection: Bottom", command: config.projBottom, configId: "projBottom" },
    { key: "Projection: Right", command: config.projRight, configId: "projRight" },
    {
      key: "Viewport Ruler",
      command: `Shift + ${config.ruler.replace("Shift + ", "")}`,
      configId: "ruler",
    },
    { key: "Chain Rulers", command: "Shift + Click" },
    { key: "Nudge Ruler", command: "Arrow Keys" },
  ];

  return (
    <section id="commands" className={styles.section}>
      <h2 className={`${styles.sectionHeader}`}>Command Palette</h2>
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
              style={{ cursor: item.configId ? "pointer" : "default" }}
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
