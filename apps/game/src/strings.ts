import { parseStrings, type Language, type StringId } from '@nebotok/core';
import raw from '../../../content/strings.json';

const strings = parseStrings(raw);

export function text(id: StringId, language: Language): string {
  return strings[id][language];
}
