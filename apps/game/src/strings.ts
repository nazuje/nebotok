import { parseStrings, type Language, type StringId } from '@nebotok/core';
import raw from '../../../content/strings.json';

const strings = parseStrings(raw);

export function text(id: StringId, language: Language): string {
  return strings[id][language];
}

/** A line with `{name}` blanks, each filled from `values`. A blank with no value stays as it is. */
export function format(id: StringId, language: Language, values: Readonly<Record<string, string | number>>): string {
  return text(id, language).replaceAll(/\{([a-zA-Z]+)\}/g, (blank, name: string) => (name in values ? String(values[name]) : blank));
}
