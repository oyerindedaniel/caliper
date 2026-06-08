import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type Accessor,
  type JSX,
  type Ref,
} from "solid-js";
import { wirePresenceExit, type PresenceDataState } from "./create-presence.js";
import { mergeRefs } from "./assign-ref.js";

type PresenceHostProps = {
  present: Accessor<boolean>;
  class?: string;
  style?: Accessor<Record<string, string | undefined>>;
  dataCaliperIgnore?: boolean;
  role?: JSX.IntrinsicElements["div"]["role"];
  ariaLabel?: string;
  id?: string;
  onExitComplete?: () => void;
  ref?: Ref<HTMLDivElement>;
  children: JSX.Element;
};

export function PresenceHost(props: PresenceHostProps) {
  const [mounted, setMounted] = createSignal(props.present());
  let nodeRef: HTMLDivElement | undefined;
  let exitCleanup: (() => void) | undefined;

  createEffect(() => {
    const present = props.present();
    exitCleanup?.();
    exitCleanup = undefined;

    if (present) {
      setMounted(true);
      return;
    }

    const node = nodeRef;
    if (!node || !mounted()) {
      setMounted(false);
      return;
    }

    exitCleanup = wirePresenceExit(node, "closed", () => {
      setMounted(false);
      props.onExitComplete?.();
    });
  });

  onCleanup(() => {
    exitCleanup?.();
  });

  const dataState = (): PresenceDataState => (props.present() ? "open" : "closed");

  return (
    <Show when={mounted()}>
      <div
        ref={mergeRefs(props.ref, (element) => {
          nodeRef = element;
        })}
        id={props.id}
        class={props.class}
        style={props.style?.()}
        data-state={dataState()}
        role={props.role}
        aria-label={props.ariaLabel}
        data-caliper-ignore={props.dataCaliperIgnore ? "" : undefined}
      >
        {props.children}
      </div>
    </Show>
  );
}
