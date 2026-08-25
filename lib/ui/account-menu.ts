export function isOutsideAccountMenu(container: Pick<Node, "contains">, target: Node): boolean {
  return !container.contains(target);
}

export function isAccountMenuDismissKey(key: string): boolean {
  return key === "Escape";
}
