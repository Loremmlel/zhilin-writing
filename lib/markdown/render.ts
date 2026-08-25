import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["target", "_blank"], "rel"],
    input: ["type", "checked", "disabled"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    img: ["src", "alt", "title", "width", "height", "loading"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

export async function renderMarkdown(markdown: string): Promise<string> {
  const safeSource = markdown.replace(
    /<(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(safeSource);

  return String(result);
}

export function markdownToPlainText(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
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
