// Writes docs/parameters.md: every rules value, what it does, and its standard setting.
// Usage: npx tsx src/cli/parameters.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { scenarioFileSchema } from '../scenario/schema';

const OUTPUT = 'docs/parameters.md';
const SECTIONS = ['ground', 'combat', 'perception', 'radio', 'display', 'air', 'weather', 'doctrines', 'terrain'] as const;

type Row = Readonly<{ path: string; description: string; value: unknown }>;

/** Strips wrappers that don't change what a value means. */
function inner(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current.unwrap() as z.ZodType;
    } else return current;
  }
}

function describe(schema: z.ZodType): string | undefined {
  return schema.description ?? inner(schema).description;
}

/** Walks the schema alongside the standard values, so each row shows what is actually set. */
export function parameterRows(schema: z.ZodType, value: unknown, path: string, inherited = ''): readonly Row[] {
  const plain = inner(schema);
  const description = describe(schema) ?? inherited;
  if (plain instanceof z.ZodRecord) {
    const entries = Object.entries((value ?? {}) as Record<string, unknown>);
    return entries.flatMap(([key, entry]) => parameterRows(plain.valueType as z.ZodType, entry, `${path}.${key}`, description));
  }
  if (plain instanceof z.ZodObject) {
    // A group's own description stands for members that have none, such as each posture's cover.
    const record = (value ?? {}) as Record<string, unknown>;
    return Object.entries(plain.shape as Record<string, z.ZodType>).flatMap(([key, field]) =>
      parameterRows(field, record[key], path === '' ? key : `${path}.${key}`, description),
    );
  }
  return [{ path, description, value }];
}

function format(value: unknown): string {
  if (value === undefined) return '';
  return '`' + JSON.stringify(value).replace(/\|/g, '\\|') + '`';
}

export function parametersMarkdown(): string {
  const rules = JSON.parse(readFileSync('scenarios/rules/standard.json', 'utf8')) as Record<string, unknown>;
  const shape = scenarioFileSchema.shape as Record<string, z.ZodType>;
  const parts = [
    '# Rules parameters',
    '',
    'Every value in `scenarios/rules/standard.json`, with what it does. A scenario file can override any of them,',
    'and `npx tsx src/cli/batch.ts --set path=value` tries one without editing anything, for example',
    '`--set combat.suppressionDecayPerUpdate=0.04`. This page is generated: run `npm run params` after changing the',
    'rules or the schema.',
    '',
  ];
  for (const section of SECTIONS) {
    const field = shape[section];
    if (field === undefined) continue;
    const rows = parameterRows(field, rules[section], section).filter((row) => row.value !== undefined);
    parts.push(`## ${section}`, '', '| Parameter | Standard | What it does |', '|---|---|---|');
    for (const row of rows) parts.push(`| \`${row.path}\` | ${format(row.value)} | ${row.description} |`);
    parts.push('');
  }
  return parts.join('\n');
}

if (process.argv[1]?.endsWith('parameters.ts')) {
  const text = parametersMarkdown();
  if (process.argv.includes('--check')) {
    const current = readFileSync(OUTPUT, 'utf8');
    if (current !== text) throw new Error(`${OUTPUT} is out of date: run npm run params`);
  } else {
    writeFileSync(OUTPUT, text);
  }
}
