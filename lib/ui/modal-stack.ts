export function isTopmostModal(root: HTMLElement): boolean {
  const dialogs = root.ownerDocument.querySelectorAll<HTMLElement>("[data-modal-dialog='true']");
  return dialogs.item(dialogs.length - 1) === root;
}
