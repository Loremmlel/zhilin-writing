export type ExistingTag = {
  id: string;
  name: string;
  normalizedName: string;
};

export type PlannedTag = ExistingTag & { createdAt: Date };

function stableTagId(normalizedName: string): string {
  const bytes = new TextEncoder().encode(normalizedName);
  return `tag:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function planPostTags(names: string[], existing: ExistingTag[], now: Date) {
  const existingByName = new Map(existing.map((tag) => [tag.normalizedName, tag]));
  const newTags: PlannedTag[] = [];
  const bindings = names.map((rawName) => {
    const name = rawName.trim();
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    const found = existingByName.get(normalizedName);
    if (found) return { tagId: found.id };
    const tag = { id: stableTagId(normalizedName), name, normalizedName, createdAt: now };
    newTags.push(tag);
    existingByName.set(normalizedName, tag);
    return { tagId: tag.id };
  });
  return { newTags, bindings };
}

export async function commitPostSave<T>(
  batch: (items: T[]) => Promise<unknown>,
  sections: {
    guard?: T;
    content: T[];
    annotations?: T[];
    assets: T[];
    tags: T[];
  },
) {
  const items = [
    ...(sections.guard ? [sections.guard] : []),
    ...sections.content,
    ...(sections.annotations ?? []),
    ...sections.assets,
    ...sections.tags,
  ];
  if (items.length === 0) throw new Error("保存事务不能为空");
  await batch(items);
}
