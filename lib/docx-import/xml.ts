import { XMLParser, XMLValidator } from "fast-xml-parser";

import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { DocxImportError } from "./types.ts";

export type OrderedXmlNode = Record<string, unknown>;
export type OrderedXmlNodes = OrderedXmlNode[];

const encoder = new TextEncoder();
const FORBIDDEN_XML_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

export function assertSafeXmlText(xml: string, partName: string): void {
  const byteLength = encoder.encode(xml).byteLength;
  if (byteLength > DOCX_IMPORT_LIMITS.xmlPartBytes) {
    throw new DocxImportError(
      "XML_PART_SIZE_LIMIT",
      `XML part exceeds the ${DOCX_IMPORT_LIMITS.xmlPartBytes}-byte limit`,
      { partName, byteLength },
    );
  }
  if (FORBIDDEN_XML_DECLARATION.test(xml)) {
    throw new DocxImportError(
      "XML_DTD_FORBIDDEN",
      "DTD and entity declarations are forbidden in DOCX XML",
      { partName },
    );
  }
  const depth = measureXmlDepth(xml);
  if (depth > DOCX_IMPORT_LIMITS.xmlDepth) {
    throw new DocxImportError(
      "XML_DEPTH_LIMIT",
      `XML nesting exceeds the ${DOCX_IMPORT_LIMITS.xmlDepth}-element limit`,
      { partName, depth },
    );
  }
}

export function parseOrderedXml(xml: string, partName: string): OrderedXmlNodes {
  assertSafeXmlText(xml, partName);
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) {
    throw new DocxImportError(
      "XML_MALFORMED",
      "DOCX XML is malformed",
      { partName, reason: validation.err.msg, line: validation.err.line, column: validation.err.col },
    );
  }

  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      processEntities: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      allowBooleanAttributes: false,
    });
    const parsed: unknown = parser.parse(xml);
    if (!Array.isArray(parsed)) {
      throw new Error("preserveOrder parser returned a non-array root");
    }
    return parsed as OrderedXmlNodes;
  } catch (error) {
    if (error instanceof DocxImportError) throw error;
    throw new DocxImportError(
      "XML_MALFORMED",
      "DOCX XML could not be parsed",
      { partName },
      { cause: error },
    );
  }
}

export function xmlChildren(
  input: OrderedXmlNode | OrderedXmlNodes,
  name?: string,
): OrderedXmlNodes {
  const nodes = Array.isArray(input) ? input : childNodeArray(input);
  if (!name) return nodes.filter((node) => tagName(node) !== undefined);
  return nodes.filter((node) => namesMatch(tagName(node), name));
}

export function xmlChild(
  input: OrderedXmlNode | OrderedXmlNodes,
  name: string,
): OrderedXmlNode | undefined {
  return xmlChildren(input, name)[0];
}

export function xmlAttr(node: OrderedXmlNode, name: string): string | undefined {
  const attributes = node[":@"];
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return undefined;
  for (const [attributeName, value] of Object.entries(attributes)) {
    if (namesMatch(attributeName.replace(/^@_/, ""), name)) return String(value);
  }
  return undefined;
}

export function xmlText(input: OrderedXmlNode | OrderedXmlNodes): string {
  if (Array.isArray(input)) return input.map((node) => xmlText(node)).join("");
  let text = "";
  for (const [name, value] of Object.entries(input)) {
    if (name === "#text") {
      text += String(value);
    } else if (name !== ":@" && Array.isArray(value)) {
      text += xmlText(value as OrderedXmlNodes);
    }
  }
  return text;
}

export function xmlName(node: OrderedXmlNode): string | undefined {
  return tagName(node);
}

function childNodeArray(node: OrderedXmlNode): OrderedXmlNodes {
  const name = tagName(node);
  if (!name) return [];
  const value = node[name];
  return Array.isArray(value) ? value as OrderedXmlNodes : [];
}

function tagName(node: OrderedXmlNode): string | undefined {
  return Object.keys(node).find((name) => name !== ":@" && name !== "#text");
}

function namesMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  return localName(actual) === localName(expected);
}

function localName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator === -1 ? name : name.slice(separator + 1);
}

function measureXmlDepth(xml: string): number {
  let cursor = 0;
  let depth = 0;
  let maximum = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start === -1) break;
    if (xml.startsWith("<!--", start)) {
      cursor = skipUntil(xml, start + 4, "-->");
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      cursor = skipUntil(xml, start + 9, "]]>");
      continue;
    }
    if (xml.startsWith("<?", start)) {
      cursor = skipUntil(xml, start + 2, "?>");
      continue;
    }

    const end = findTagEnd(xml, start + 1);
    if (end === -1) break;
    const body = xml.slice(start + 1, end).trim();
    if (body.startsWith("/")) {
      depth = Math.max(0, depth - 1);
    } else if (body && !body.startsWith("!") && !body.endsWith("/")) {
      depth += 1;
      maximum = Math.max(maximum, depth);
      if (maximum > DOCX_IMPORT_LIMITS.xmlDepth) return maximum;
    }
    cursor = end + 1;
  }
  return maximum;
}

function findTagEnd(xml: string, start: number): number {
  let quote: "\"" | "'" | undefined;
  for (let cursor = start; cursor < xml.length; cursor += 1) {
    const character = xml[cursor];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  return -1;
}

function skipUntil(xml: string, start: number, terminator: string): number {
  const end = xml.indexOf(terminator, start);
  return end === -1 ? xml.length : end + terminator.length;
}
