/**
 * Extracts and cleans the direct text content of an element, excluding text
 * from child elements.
 *
 * @param element - The element to extract text from.
 * @param maxLength - Optional maximum length for the extracted string.
 * @returns The cleaned text content or undefined if no text found.
 */
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
