import type { BoxEdges, CaliperComputedStyles } from "./audit.js";
import type { Id } from "./bridge.js";

export type StyleSerializerEntry<Value> = {
  collectStrings: (value: Value, collect: (strVal: string | null | undefined) => void) => void;
  serialize: (value: Value, context: SerializeContext) => void;
  deserialize: (context: DeserializeContext) => Value;
};

export type StyleSerializerMap = {
  [StyleKey in keyof CaliperComputedStyles]: StyleSerializerEntry<CaliperComputedStyles[StyleKey]>;
};

export interface SerializeContext {
  view: DataView;
  offset: number;
  getStringId: (strVal: string | null | undefined) => number;
}

export interface DeserializeContext {
  view: DataView;
  offset: number;
  stringList: string[];
}

function writeUint16StringId(context: SerializeContext, value: string | null | undefined): void {
  context.view.setUint16(context.offset, context.getStringId(value));
  context.offset += 2;
}

function readUint16StringId(context: DeserializeContext): { id: number; strValue: string | undefined } {
  const id = context.view.getUint16(context.offset);
  context.offset += 2;
  return { id, strValue: context.stringList[id] };
}

function stringIdFieldSerializer(
  options: {
    defaultValue?: string;
    treatEmptyAsUndefined?: boolean;
  } = {}
): StyleSerializerEntry<string | undefined> {
  const defaultValue = options.defaultValue ?? "";
  const treatEmptyAsUndefined = options.treatEmptyAsUndefined ?? false;

  return {
    collectStrings: (value, collect) => collect(value),
    serialize: (value, context) => writeUint16StringId(context, value),
    deserialize: (context) => {
      const { id, strValue } = readUint16StringId(context);
      if (treatEmptyAsUndefined) {
        if (!strValue || id === 0) {
          return undefined;
        }
        return strValue;
      }
      return strValue || defaultValue || undefined;
    },
  };
}

function floatFieldSerializer(): StyleSerializerEntry<number | undefined> {
  return {
    collectStrings: () => {},
    serialize: (value, context) => {
      context.view.setFloat32(context.offset, value ?? 0);
      context.offset += 4;
    },
    deserialize: (context) => {
      const numericValue = context.view.getFloat32(context.offset);
      context.offset += 4;
      return numericValue;
    },
  };
}

function boxEdgesFieldSerializer(): StyleSerializerEntry<BoxEdges | undefined> {
  return {
    collectStrings: () => {},
    serialize: (edges, context) => {
      context.view.setFloat32(context.offset, edges?.top ?? 0);
      context.offset += 4;
      context.view.setFloat32(context.offset, edges?.right ?? 0);
      context.offset += 4;
      context.view.setFloat32(context.offset, edges?.bottom ?? 0);
      context.offset += 4;
      context.view.setFloat32(context.offset, edges?.left ?? 0);
      context.offset += 4;
    },
    deserialize: (context) => {
      const edges = {
        top: context.view.getFloat32(context.offset),
        right: context.view.getFloat32(context.offset + 4),
        bottom: context.view.getFloat32(context.offset + 8),
        left: context.view.getFloat32(context.offset + 12),
      };
      context.offset += 16;
      if (edges.top === 0 && edges.right === 0 && edges.bottom === 0 && edges.left === 0) {
        return undefined;
      }
      return edges;
    },
  };
}

function parseStringTableNumber(strValue: string): number | string {
  const numericValue = parseFloat(strValue);
  return Number.isNaN(numericValue) ? strValue : numericValue;
}

function nullableNumberFieldSerializer(): StyleSerializerEntry<number | null | undefined> {
  return {
    collectStrings: (value, collect) => collect(value == null ? null : String(value)),
    serialize: (value, context) =>
      writeUint16StringId(context, value == null ? null : String(value)),
    deserialize: (context) => {
      const strValue = context.stringList[context.view.getUint16(context.offset)] || null;
      context.offset += 2;
      if (strValue === null) {
        return null;
      }
      return parseFloat(strValue);
    },
  };
}

function numberOrStringFieldSerializer(
  defaultValue: Id = ""
): StyleSerializerEntry<number | string | undefined> {
  return {
    collectStrings: (value, collect) => collect(value == null ? undefined : String(value)),
    serialize: (value, context) =>
      writeUint16StringId(context, value == null ? undefined : String(value)),
    deserialize: (context) => {
      const { id, strValue } = readUint16StringId(context);
      if (!strValue && id === 0) {
        return defaultValue;
      }
      if (!strValue) {
        return undefined;
      }
      return parseStringTableNumber(strValue);
    },
  };
}

function nullableNumberOrStringFieldSerializer(): StyleSerializerEntry<
  number | string | null | undefined
> {
  return {
    collectStrings: (value, collect) => collect(value == null ? null : String(value)),
    serialize: (value, context) =>
      writeUint16StringId(context, value == null ? null : String(value)),
    deserialize: (context) => {
      const strValue = context.stringList[context.view.getUint16(context.offset)] || null;
      context.offset += 2;
      if (strValue === null) {
        return null;
      }
      return parseStringTableNumber(strValue);
    },
  };
}

export const STYLE_SERIALIZERS = {
  display: stringIdFieldSerializer(),
  visibility: stringIdFieldSerializer(),
  position: stringIdFieldSerializer(),
  boxSizing: stringIdFieldSerializer(),
  padding: boxEdgesFieldSerializer(),
  margin: boxEdgesFieldSerializer(),
  border: boxEdgesFieldSerializer(),
  gap: nullableNumberFieldSerializer(),
  flexDirection: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  justifyContent: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  alignItems: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  fontSize: floatFieldSerializer(),
  fontWeight: stringIdFieldSerializer(),
  fontFamily: stringIdFieldSerializer(),
  lineHeight: nullableNumberOrStringFieldSerializer(),
  letterSpacing: numberOrStringFieldSerializer(0),
  color: stringIdFieldSerializer(),
  backgroundColor: stringIdFieldSerializer(),
  borderColor: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  borderRadius: stringIdFieldSerializer({ defaultValue: "0" }),
  boxShadow: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  opacity: numberOrStringFieldSerializer(1),
  outline: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  outlineColor: stringIdFieldSerializer({ treatEmptyAsUndefined: true }),
  zIndex: nullableNumberOrStringFieldSerializer(),
  overflow: stringIdFieldSerializer({ defaultValue: "visible" }),
  overflowX: stringIdFieldSerializer({ defaultValue: "visible" }),
  overflowY: stringIdFieldSerializer({ defaultValue: "visible" }),
  contentVisibility: stringIdFieldSerializer({ defaultValue: "visible" }),
} satisfies StyleSerializerMap;

export const STYLE_KEYS = Object.keys(STYLE_SERIALIZERS) as (keyof CaliperComputedStyles)[];

type MissingStyleSerializerKeys = Exclude<keyof CaliperComputedStyles, keyof typeof STYLE_SERIALIZERS>;
type EnsureStyleSerializerCoverage = MissingStyleSerializerKeys extends never
  ? true
  : ["Missing STYLE_SERIALIZERS for", MissingStyleSerializerKeys];
const _styleSerializerCoverage: EnsureStyleSerializerCoverage = true;

function applyStyleSerializer<Key extends keyof CaliperComputedStyles>(
  styleKey: Key,
  value: CaliperComputedStyles[Key],
  run: (
    entry: StyleSerializerEntry<CaliperComputedStyles[Key]>,
    fieldValue: CaliperComputedStyles[Key]
  ) => void
): void {
  const entry = STYLE_SERIALIZERS[styleKey] as StyleSerializerEntry<CaliperComputedStyles[Key]>;
  run(entry, value);
}

export function collectComputedStyleStrings(
  styles: CaliperComputedStyles,
  collect: (strVal: string | null | undefined) => void
): void {
  for (const styleKey of STYLE_KEYS) {
    applyStyleSerializer(styleKey, styles[styleKey], (entry, fieldValue) => {
      entry.collectStrings(fieldValue, collect);
    });
  }
}

export function serializeComputedStyles(
  styles: CaliperComputedStyles,
  context: SerializeContext
): void {
  for (const styleKey of STYLE_KEYS) {
    applyStyleSerializer(styleKey, styles[styleKey], (entry, fieldValue) => {
      entry.serialize(fieldValue, context);
    });
  }
}

function deserializeStyleField<Key extends keyof CaliperComputedStyles>(
  styleKey: Key,
  context: DeserializeContext
): CaliperComputedStyles[Key] {
  const entry = STYLE_SERIALIZERS[styleKey] as StyleSerializerEntry<CaliperComputedStyles[Key]>;
  return entry.deserialize(context);
}

function assignStyleField<Key extends keyof CaliperComputedStyles>(
  styles: CaliperComputedStyles,
  styleKey: Key,
  value: CaliperComputedStyles[Key]
): void {
  styles[styleKey] = value;
}

export function deserializeComputedStyles(context: DeserializeContext): CaliperComputedStyles {
  const styles = {} as CaliperComputedStyles;
  for (const styleKey of STYLE_KEYS) {
    assignStyleField(styles, styleKey, deserializeStyleField(styleKey, context));
  }
  return styles;
}
