export function getElementDirectText(
  element: Element,
  maxLength: number = 100
): string | undefined {
  let directText = "";

  const children = element.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child?.nodeType === Node.TEXT_NODE) {
      directText += child.textContent || "";
    }
  }

  const trimmed = directText.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;

  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
}
