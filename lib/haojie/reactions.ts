export const HAOJIE_EMOJIS = [
  ["😀", "开心"],
  ["😂", "笑哭"],
  ["🤣", "大笑"],
  ["😅", "汗颜"],
  ["🥹", "感动"],
  ["😎", "得意"],
  ["🥳", "庆祝"],
  ["🤔", "思考"],
  ["🧐", "观察"],
  ["😏", "坏笑"],
  ["😮", "惊讶"],
  ["😱", "震惊"],
  ["😭", "大哭"],
  ["🥲", "苦笑"],
  ["😤", "不服"],
  ["😡", "生气"],
  ["🤯", "脑袋炸了"],
  ["😴", "困了"],
  ["🙃", "倒脸"],
  ["🫠", "融化"],
  ["👍", "赞"],
  ["👎", "踩"],
  ["👏", "鼓掌"],
  ["🙏", "拜托"],
  ["🤝", "握手"],
  ["💪", "加油"],
  ["❤️", "爱心"],
  ["🔥", "火热"],
  ["🎉", "礼花"],
  ["💀", "骷髅"],
] as const;
export type HaojieEmoji = (typeof HAOJIE_EMOJIS)[number][0];
export type RoomReaction = {
  id: string;
  sequence: number;
  player: 1 | 2;
  emoji: HaojieEmoji;
  createdAt: number;
};
export type RoomReactions = { sequence: number; items: RoomReaction[] };
export type ReactionInput = { id: string; emoji: HaojieEmoji };
export const REACTION_BATCH_SIZE = 8;
export const REACTION_RELEASE_MS = 150;
export const REACTION_TTL_MS = 10000;
export const REACTION_LIMIT = 128;

/** Pixel-space y = a(x - x0)^2 - 64; a >= .025 keeps the fall narrow. */
export function reactionFlight(id: string, width: number, height: number) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const distance = height + 128;
  const limit = Math.min(180, Math.sqrt(distance / 0.025), Math.max(0, (width - 80) / 3));
  const drift = (random() < 0.5 ? -1 : 1) * limit * (0.45 + random() * 0.55);
  const left = 8 + Math.max(0, -drift);
  const right = width - 64 - 8 - Math.max(0, drift);
  const start = left + random() * Math.max(0, right - left);
  const tilt = (random() - 0.5) * 24;
  return {
    duration: 2200 + random() * 500,
    start,
    drift,
    distance,
    keyframes: Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return {
        offset: t,
        transform: `translate(${start + drift * t}px, ${-64 + distance * t * t}px) rotate(${tilt * t}deg)`,
      };
    }),
  };
}
