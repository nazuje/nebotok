export function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

type Props = { readonly className?: string; readonly text?: string; readonly attrs?: Readonly<Record<string, string>> };

/** A small element builder, so screens read as their structure. Text always goes in as text, never HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: readonly Node[] = []): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (props.className) made.className = props.className;
  if (props.text !== undefined) made.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) made.setAttribute(name, value);
  made.append(...children);
  return made;
}

export function button(className: string, label: string, onTap: () => void): HTMLButtonElement {
  const made = el('button', { className, text: label, attrs: { type: 'button' } });
  made.addEventListener('click', onTap);
  return made;
}

const SVG = 'http://www.w3.org/2000/svg';

/** An icon from SVG path data, hidden from screen readers: its button carries the label. */
export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(SVG, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill-rule', 'evenodd');
  svg.append(shape);
  return svg;
}
