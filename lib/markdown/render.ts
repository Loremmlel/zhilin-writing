import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Handler } from "mdast-util-to-hast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["target", "_blank"], "rel"],
    input: ["type", "checked", "disabled"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    mark: ["className", "dataAnnotationId", "tabIndex", "ariaLabel"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

const annotationHandler: Handler = (state, node) => {
  const annotationId = node?.name === "annotation" && typeof node.attributes?.id === "string" ? node.attributes.id : "";
  const result = {
    type: "element" as const,
    tagName: "mark",
    properties: { className: ["annotation-range"], dataAnnotationId: annotationId, tabIndex: 0, ariaLabel: "带批注的文字，按回车查看批注" },
    children: state.all(node),
  };
  state.patch(node, result);
  return state.applyData(node, result);
};

export async function renderMarkdown(markdown: string): Promise<string> {
  const safeSource = markdown.replace(
    /<(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkRehype, { handlers: { textDirective: annotationHandler } })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(safeSource);

  return String(result);
}

export function markdownToPlainText(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).parse(markdown);
  const chunks: string[] = [];

  function collect(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const current = node as {
      type?: string;
      value?: string;
      alt?: string;
      children?: unknown[];
    };
    if (current.type === "text" || current.type === "inlineCode" || current.type === "code") {
      if (current.value) chunks.push(current.value);
      return;
    }
    if (current.type === "image" && current.alt) chunks.push(current.alt);
    current.children?.forEach(collect);
    if (["heading", "paragraph", "listItem", "tableCell", "blockquote"].includes(current.type ?? "")) {
      chunks.push(" ");
    }
  }

  collect(tree);
  return chunks.join("").replace(/\s+/g, " ").trim();
}
