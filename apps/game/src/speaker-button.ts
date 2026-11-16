import { button } from './dom.ts';
import { pictureIcon } from './pictures.ts';

/** A speaker button that reads something aloud when tapped, whatever "Read to me" is set to. */
export function speakerButton(className: string, label: string, onTap: () => void): HTMLButtonElement {
  const made = button(`speaker-button ${className}`, '', onTap);
  made.setAttribute('aria-label', label);
  made.append(pictureIcon('speaker', 32));
  return made;
}
