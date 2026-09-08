import { textColor } from "../markdown/formatting.ts";
import { xmlAttr, xmlChild, xmlChildren, xmlName, type OrderedXmlNodes } from "./xml.ts";
export type WordColor = { value?: string; theme?: string; tint?: string; shade?: string };
export function themeColors(nodes: OrderedXmlNodes): Map<string, string> {
  const root = xmlChild(nodes, "theme");
  const elements = xmlChild(root ?? {}, "themeElements");
  const scheme = xmlChild(elements ?? {}, "clrScheme");
  const colors = new Map<string, string>();
  for (const slot of xmlChildren(scheme ?? {})) {
    const source = xmlChild(slot, "srgbClr") ?? xmlChild(slot, "sysClr");
    const value = source && (xmlAttr(source, "lastClr") ?? xmlAttr(source, "val"));
    const color = textColor("#" + value);
    if (color) colors.set((xmlName(slot) ?? "").split(":").at(-1)!, color);
  }
  return colors;
}
/** MS-OE376 §2.1.74; use full-precision HSL then round RGB channels.
 * Published rounded-HSL examples may differ by one RGB unit.
 * OOXML theme tint/shade changes HSL luminance, preserving hue and saturation. */
export function resolveWordColor(
  source: WordColor,
  theme: ReadonlyMap<string, string>,
): { color?: string; fallback: boolean } {
  const aliases: Record<string, string> = {
    dark1: "dk1",
    dark2: "dk2",
    light1: "lt1",
    light2: "lt2",
    hyperlink: "hlink",
    followedHyperlink: "folHlink",
    text1: "dk1",
    text2: "dk2",
    background1: "lt1",
    background2: "lt2",
  };
  const base = source.theme ? theme.get(aliases[source.theme] ?? source.theme) : undefined;
  const fallback = source.theme !== undefined && !base;
  if (!base)
    return {
      color: source.value === "auto" ? undefined : textColor("#" + source.value),
      fallback: fallback || (source.value !== "auto" && !textColor("#" + source.value)),
    };
  const modifier = source.tint ?? source.shade;
  if (modifier === undefined) return { color: base, fallback: false };
  if (!/^[0-9a-f]{2}$/i.test(modifier)) return { color: base, fallback: true };
  const factor = parseInt(modifier, 16) / 255;
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(base.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r!, g!, b!),
    min = Math.min(r!, g!, b!),
    delta = max - min;
  const light = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue =
    delta === 0
      ? 0
      : max === r
        ? ((g! - b!) / delta) % 6
        : max === g
          ? (b! - r!) / delta + 2
          : (r! - g!) / delta + 4;
  hue = (hue + 6) % 6;
  const target = source.tint !== undefined ? 1 - (1 - light) * factor : light * factor;
  const chroma = (1 - Math.abs(2 * target - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const triplets = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const rgb = triplets[Math.floor(hue)]!.map((value) =>
    Math.round((value + target - chroma / 2) * 255),
  );
  return {
    color:
      "#" +
      rgb.map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join(""),
    fallback: false,
  };
}
