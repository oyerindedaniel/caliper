import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import { PREFIX } from "../../css/styles.js";
import { isHandoffMentionElement, readMentionAgentId } from "./handoff-note-dom.js";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";

export type HandoffNoteEditorProps = {
  wire: Accessor<string>;
  colorByAgentId: Accessor<Map<string, string>>;
  highlightedAgentId?: Accessor<string | null>;
  onWireChange: (wire: string) => void;
  onResize?: () => void;
  onEditorReady?: (editor: HandoffNoteEditor) => void;
  onKeyDown?: (event: KeyboardEvent, editor: HandoffNoteEditor) => void;
  onMentionPress?: (agentId: string) => void;
  ariaControls?: Accessor<string | undefined>;
  ariaActiveDescendant?: Accessor<string | undefined>;
  placeholder?: string;
};

export function HandoffNoteEditor(props: HandoffNoteEditorProps) {
  let rootRef: HTMLDivElement | undefined;
  let suppressWireSync = false;
  const editor = createHandoffNoteEditor({
    getColorByAgentId: () => props.colorByAgentId(),
    getHighlightedAgentId: () => props.highlightedAgentId?.() ?? null,
    onWireChange: (wire) => {
      suppressWireSync = true;
      props.onWireChange(wire);
    },
    onResize: () => props.onResize?.(),
  });

  onMount(() => {
    const root = rootRef;
    if (!root) {
      return;
    }
    editor.setRoot(root);
    props.onEditorReady?.(editor);
    const wire = props.wire();
    editor.setDocFromWire(wire, wire.length, { resetHistory: true });
    editor.resize();
  });

  createEffect(() => {
    const wire = props.wire();
    if (suppressWireSync) {
      suppressWireSync = false;
      return;
    }
    const editorWire = editor.getWire();
    if (editorWire !== wire) {
      editor.setDocFromWire(wire, editor.getCursor());
    }
  });

  createEffect(() => {
    props.highlightedAgentId?.();
    props.colorByAgentId();
    editor.refreshPresentation();
  });

  onCleanup(() => {
    editor.setRoot(undefined);
  });

  return (
    <div
      ref={rootRef}
      class={`${PREFIX}handoff-note-editor`}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label={props.placeholder ?? "Note · @ to tag"}
      aria-controls={props.ariaControls?.()}
      aria-autocomplete="list"
      aria-activedescendant={props.ariaActiveDescendant?.()}
      spellcheck={false}
      data-placeholder={props.placeholder ?? "Note · @ to tag"}
      onBeforeInput={(event) => editor.handleBeforeInput(event)}
      onInput={() => editor.handleInput()}
      onKeyDown={(event) => {
        props.onKeyDown?.(event, editor);
        if (!event.defaultPrevented) {
          editor.handleKeyDown(event);
        }
      }}
      onCompositionStart={() => editor.handleCompositionStart()}
      onCompositionEnd={() => editor.handleCompositionEnd()}
      onMouseDown={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !isHandoffMentionElement(target)) {
          return;
        }
        event.preventDefault();
        props.onMentionPress?.(readMentionAgentId(target));
      }}
      onCopy={(event) => {
        const wire = editor.getSelectionWire();
        if (!wire) {
          return;
        }
        event.preventDefault();
        event.clipboardData?.setData("text/plain", wire);
      }}
      onCut={(event) => {
        const wire = editor.getSelectionWire();
        if (!wire) {
          return;
        }
        event.preventDefault();
        event.clipboardData?.setData("text/plain", wire);
        editor.deleteSelection();
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) {
          return;
        }
        editor.insertDocText(text);
      }}
    />
  );
}
