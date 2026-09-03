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

const annotationIdPattern =
  /^ann_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function directiveHandler(allowedAnnotationIds?: Set<string>, interactive = true): Handler {
  return (state, node) => {
    const annotationId =
      node?.name === "annotation" && typeof node.attributes?.id === "string"
        ? node.attributes.id
        : "";
    const admitted =
      annotationIdPattern.test(annotationId) &&
      (!allowedAnnotationIds || allowedAnnotationIds.has(annotationId));
    const result = admitted
      ? {
          type: "element" as const,
          tagName: "mark",
          properties: interactive
            ? {
                className: ["annotation-range"],
                dataAnnotationId: annotationId,
                tabIndex: 0,
                ariaLabel: "带批注的文字，按回车查看批注",
              }
            : {
                className: ["annotation-range", "annotation-range--preview"],
                dataAnnotationId: annotationId,
                ariaLabel: "带批注的文字",
              },
          children: state.all(node),
        }
      : {
          type: "element" as const,
          tagName: "span",
          properties: {},
          children: state.all(node),
        };
    state.patch(node, result);
    return state.applyData(node, result);
  };
}

export async function renderMarkdown(
  markdown: string,
  options: { annotationIds?: string[]; interactiveAnnotations?: boolean } = {},
): Promise<string> {
  const safeSource = markdown.replace(
    /<(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkRehype, {
      handlers: {
        textDirective: directiveHandler(
          options.annotationIds ? new Set(options.annotationIds) : undefined,
          options.interactiveAnnotations ?? true,
        ),
      },
    })
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
    if (
      ["heading", "paragraph", "listItem", "tableCell", "blockquote"].includes(current.type ?? "")
    ) {
      chunks.push(" ");
    }
  }

  collect(tree);
  return chunks.join("").replace(/\s+/g, " ").trim();
}
