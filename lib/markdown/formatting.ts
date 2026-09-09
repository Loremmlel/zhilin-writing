/** The only admitted document presentation values. No user CSS crosses this boundary. */
export type TextStyle = { size?: number; color?: string };
export type FormatNode = {
  type: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
  children?: FormatNode[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  value?: string;
  [key: string]: unknown;
};

export function fontSize(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return;
  const size = Number(value);
  return Number.isFinite(size) && size >= 6 && size <= 72 && Number.isInteger(size * 2)
    ? size
    : undefined;
}
export function textColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}
export function readTextStyle(attributes: Record<string, unknown> | null | undefined): TextStyle {
  const size = fontSize(attributes?.size);
  const color = textColor(attributes?.color);
  return { ...(size === undefined ? {} : { size }), ...(color ? { color } : {}) };
}
export function textStyleAttributes(style: TextStyle): Record<string, string> {
  const safe = readTextStyle(style);
  return {
    ...(safe.size === undefined ? {} : { size: String(safe.size) }),
    ...(safe.color ? { color: safe.color } : {}),
  };
}
export function textStyleCss(style: TextStyle): string {
  const safe = readTextStyle(style);
  return [
    safe.size === undefined ? "" : `font-size:${Number((safe.size / 12).toFixed(6))}rem`,
    safe.color ? `color:${safe.color}` : "",
  ]
    .filter(Boolean)
    .join(";");
}
export function isTextStyleDirective(node: {
  type: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
}): boolean {
  if (node.type !== "textDirective" || node.name !== "text") return false;
  const attributes = node.attributes ?? {};
  return (
    Object.keys(attributes).length > 0 &&
    Object.entries(attributes).every(([key, value]) =>
      key === "size"
        ? fontSize(value) !== undefined
        : key === "color" && textColor(value) !== undefined,
    )
  );
}
function validAlign(node: FormatNode): boolean {
  return (
    node.name === "align" &&
    node.attributes?.value === "center" &&
    Object.keys(node.attributes).length === 1
  );
}
export function centered(node: { data?: unknown }): boolean {
  return (
    !!node.data &&
    typeof node.data === "object" &&
    "textAlign" in node.data &&
    node.data.textAlign === "center"
  );
}
function center(node: FormatNode): FormatNode {
  node.data = { ...node.data, textAlign: "center", hProperties: { dataTextAlign: "center" } };
  return node;
}

function literalBareDirective(node: FormatNode): FormatNode {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (
    node.type !== "textDirective" ||
    !node.name ||
    node.children?.length ||
    Object.keys(node.attributes ?? {}).length ||
    typeof from !== "number" ||
    typeof to !== "number" ||
    to - from !== node.name.length + 1
  )
    return node;
  return { type: "text", value: `:${node.name}`, position: node.position };
}

/** Invalid wrappers remain barriers; never unwrap arbitrary layout as an eligible annotation block. */
export function normalizeFormatting<T>(tree: T): T {
  const walk = (node: FormatNode) => {
    if (node.type === "tableCell" && node.children?.length === 1) {
      const child = node.children[0]!;
      if (child.type === "textDirective" && validAlign(child)) {
        center(node);
        node.children = child.children ?? [];
      }
    }
    node.children = node.children?.map((child) => {
      child = literalBareDirective(child);
      if (
        child.type === "containerDirective" &&
        validAlign(child) &&
        child.children?.length === 1 &&
        ["paragraph", "heading"].includes(child.children[0]!.type)
      ) {
        child = center(child.children[0]!);
      } else if (child.type === "leafDirective" && validAlign(child) && !child.children?.length) {
        // A leaf is the unambiguous transport for an empty centered paragraph.
        child = center({ type: "paragraph", children: [], position: child.position });
      }
      walk(child);
      return child;
    });
  };
  walk(tree as FormatNode);
  return tree;
}
export function encodeFormatting<T>(tree: T): T {
  const copy = structuredClone(tree);
  const walk = (node: FormatNode): FormatNode => {
    node.children = node.children?.map(walk);
    if (!centered(node)) return node;
    const data = { ...node.data };
    delete data.textAlign;
    delete data.hProperties;
    node.data = data;
    if (node.type === "tableCell") {
      node.children = [
        {
          type: "textDirective",
          name: "align",
          attributes: { value: "center" },
          children: node.children ?? [],
        },
      ];
      return node;
    }
    if (["paragraph", "heading"].includes(node.type)) {
      if (node.type === "paragraph" && !node.children?.length)
        return {
          type: "leafDirective",
          name: "align",
          attributes: { value: "center" },
          children: [],
        };
      return {
        type: "containerDirective",
        name: "align",
        attributes: { value: "center" },
        children: [node],
      };
    }
    return node;
  };
  return walk(copy as FormatNode) as T;
}
export function formattingIsValid(tree: unknown): boolean {
  let valid = true;
  const walk = (node: FormatNode) => {
    if (node.name === "text" && node.type.endsWith("Directive") && !isTextStyleDirective(node))
      valid = false;
    // All legal align directives have already been normalized to existing blocks.
    if (node.name === "align" && node.type.endsWith("Directive")) valid = false;
    node.children?.forEach(walk);
  };
  walk(tree as FormatNode);
  return valid;
}
export function remarkFormatting() {
  return (tree: unknown) => {
    normalizeFormatting(tree);
  };
}

/** Editor serialization may keep an outer format open before an annotation starts.
 * Hoist annotation identity over its continuous formatted leaves, without joining gaps. */
export function canonicalizeEditorAnnotations(tree: FormatNode): void {
  const walk = (node: FormatNode) => {
    if (!["paragraph", "heading", "tableCell"].includes(node.type)) {
      node.children?.forEach(walk);
      return;
    }
    type Piece = { leaf: FormatNode; wrappers: FormatNode[]; id: string | null };
    const pieces: Piece[] = [];
    let nested = false;
    const flatten = (item: FormatNode, wrappers: FormatNode[], id: string | null) => {
      if (item.type === "textDirective" && item.name === "annotation") {
        if (id) nested = true;
        item.children?.forEach((child) =>
          flatten(child, wrappers, String(item.attributes?.id ?? "")),
        );
      } else if (item.children)
        item.children.forEach((child) => flatten(child, [...wrappers, item], id));
      else pieces.push({ leaf: item, wrappers, id });
    };
    node.children?.forEach((child) => flatten(child, [], null));
    if (nested || !pieces.some((piece) => piece.id)) return;
    const result: FormatNode[] = [];
    let previousId: string | null = null;
    let group: FormatNode[] = result;
    const append = (target: FormatNode[], item: FormatNode) => {
      const previous = target.at(-1);
      const signature = (n: FormatNode) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(n).filter(([k]) => !["children", "position", "isMark"].includes(k)),
          ),
        );
      if (previous?.children && item.children && signature(previous) === signature(item)) {
        item.children.forEach((child) => append(previous.children!, child));
      } else if (previous?.type === "text" && item.type === "text")
        previous.value = (previous.value ?? "") + (item.value ?? "");
      else target.push(item);
    };
    for (const piece of pieces) {
      if (piece.id !== previousId || !result.length) {
        group = result;
        if (piece.id) {
          const anchor: FormatNode = {
            type: "textDirective",
            name: "annotation",
            attributes: { id: piece.id },
            children: [],
          };
          result.push(anchor);
          group = anchor.children!;
        }
        previousId = piece.id;
      }
      let child = piece.leaf;
      for (const wrapper of [...piece.wrappers].reverse())
        child = { ...wrapper, children: [child] };
      append(group, child);
    }
    node.children = result;
  };
  walk(tree);
}
