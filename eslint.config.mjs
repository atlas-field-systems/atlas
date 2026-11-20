import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@typescript-eslint/parser';
import typescript from '@typescript-eslint/eslint-plugin';

const root = fileURLToPath(new URL('.', import.meta.url));
const parts = {
  protocol: [],
  core: ['protocol(?:/|$)'],
  sdk: ['protocol(?:/|$)', 'core/event-kinds$'],
  asset: ['sdk(?:/|$)', 'protocol(?:/|$)'],
  simulations: null,
};
const partFiles = part => `${part}/**/*.{ts,mjs}`;

const messages = {
  clock: 'Use the injected clock (clock.now() or clock.after()). See simulations/README.md#what-each-part-allows.',
  flight: 'Keep node-mavlink in the Asset driver, its tests, or Simulations. See atlas/CHARTER.md#keep-judgment-sharp.',
  validator: 'Validate shared records through Protocol. Keep AJV in Protocol and Zod in Asset runtime. See atlas/CHARTER.md#keep-judgment-sharp.',
  part: 'Use an allowed Atlas package import. Keep private modules inside their part. See atlas/CHARTER.md#keep-the-systems-replaceable and core/docs/architecture.md.',
  catch: 'Handle the error or record it through diagnostics in the owning part. See atlas/CHARTER.md#keep-evidence-honest and atlas/CHARTER.md#keep-judgment-sharp.',
};

// These two built-in rules have no message option.
export const lintHelp = {
  '@typescript-eslint/no-explicit-any': 'Use the actual type or validate unknown at the boundary. See atlas/CHARTER.md#test-what-matters.',
  'no-warning-comments': 'Fix the root cause or record the unresolved issue in the Open section of the owning doc. See atlas/CHARTER.md#keep-judgment-sharp and atlas/CHARTER.md#change-atlas-deliberately.',
};

const packages = (part, { flight = false, zod = false } = {}) => [
  ...(!flight ? [{ regex: '^node-mavlink(?:/|$)', message: messages.flight }] : []),
  ...(part !== 'protocol' ? [{ regex: '^ajv(?:-formats)?(?:/|$)', message: messages.validator }] : []),
  ...(!zod ? [{ regex: '^zod(?:/|$)', message: messages.validator }] : []),
  ...(parts[part] ? [{
    regex: `^@atlas/(?!(?:${[part + '(?:/|$)', ...parts[part]].join('|')}))`,
    message: messages.part,
  }] : []),
];
const exceptions = {
  asset: [
    { files: ['asset/src/ardupilot.ts'], flight: true, zod: true },
    { files: ['asset/test/**/*.{ts,mjs}'], flight: true },
    { files: ['asset/src/**/*.{ts,mjs}'], ignores: ['asset/src/ardupilot.ts'], zod: true },
  ],
  simulations: [{ files: [partFiles('simulations')], flight: true }],
};

// The built-in import rule covers static package imports and exports. Resolving
// relative paths and checking literal dynamic specifiers need the current file.
const moduleBoundaries = {
  meta: {
    schema: [{
      type: 'object',
      properties: { flight: { type: 'boolean' }, zod: { type: 'boolean' } },
      additionalProperties: false,
    }],
  },
  create(context) {
    const file = context.physicalFilename;
    const [part] = relative(root, file).split(sep);
    const partRoot = resolve(root, part);
    const restrictions = packages(part, context.options[0]).map(({ regex, message }) =>
      ({ pattern: new RegExp(regex), message }));
    function check(source, dynamic = false) {
      const specifier = source?.value ??
        (source?.type === 'TemplateLiteral' && !source.expressions.length
          ? source.quasis[0].value.cooked : undefined);
      if (typeof specifier !== 'string') return;
      if (/^\.{1,2}(?:\/|$)/.test(specifier)) {
        const path = relative(partRoot, resolve(dirname(file), specifier));
        if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
          context.report({ node: source, message: messages.part });
      } else if (dynamic) {
        for (const { pattern, message } of restrictions)
          if (pattern.test(specifier)) context.report({ node: source, message });
      }
    }
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source, true),
      TSImportType: node => check(node.source, true),
      TSExternalModuleReference: node => check(node.expression, true),
      'CallExpression[callee.name="require"]': node => check(node.arguments[0], true),
    };
  },
};

const runtime = ['core', 'sdk', 'asset'].map(part => `${part}/src/**/*.{ts,mjs}`);
const syntax = (message, ...selectors) => selectors.map(selector => ({ selector, message }));
const catchCall = 'CallExpression:matches([callee.property.name="catch"], [callee.property.value="catch"])';
const catchRestrictions = syntax(messages.catch,
  'CatchClause[body.body.length=0]',
  `${catchCall}[arguments.0.body.type="BlockStatement"][arguments.0.body.body.length=0]`,
  `${catchCall}[arguments.0.body.type="Identifier"][arguments.0.body.name="undefined"]`,
);

export default [
  { ignores: ['**/node_modules/', '**/dist/', '**/build/', 'protocol/_site/', 'protocol/types.d.ts', 'simulations/.runs/'] },
  {
    files: Object.keys(parts).map(partFiles),
    languageOptions: { parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    plugins: {
      '@typescript-eslint': typescript,
      atlas: { rules: { 'module-boundaries': moduleBoundaries } },
    },
    rules: {
      'no-warning-comments': ['error', {
        terms: ['todo', 'fixme', 'hack', 'workaround', 'for now', 'temporary', 'xxx', 'kludge'],
        location: 'anywhere',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  ...Object.keys(parts).flatMap(part => {
    const overrides = exceptions[part] ?? [];
    return [
      { files: [partFiles(part)], ignores: overrides.flatMap(({ files }) => files) },
      ...overrides,
    ].map(({ files, ignores = [], flight = false, zod = false }) => ({
      files,
      ignores,
      rules: {
        'no-restricted-imports': ['error', {
          patterns: packages(part, { flight, zod }).map(pattern => ({ ...pattern, caseSensitive: true })),
        }],
        'atlas/module-boundaries': ['error', { flight, zod }],
      },
    }));
  }),
  {
    files: runtime,
    rules: { 'no-restricted-syntax': ['error', ...catchRestrictions] },
  },
  {
    files: runtime,
    ignores: ['core/src/clock.ts', 'sdk/src/clock.ts'],
    rules: {
      'no-restricted-globals': ['error', {
        globals: ['setTimeout', 'setInterval'].map(name => ({ name, message: messages.clock })),
        checkGlobalObject: true,
      }],
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: messages.clock },
        { object: 'performance', property: 'now', message: messages.clock },
      ],
      'no-restricted-syntax': ['error', ...catchRestrictions, ...syntax(messages.clock,
        'NewExpression[arguments.length=0]:matches([callee.name="Date"], [callee.property.name="Date"], [callee.property.value="Date"])',
        'MemberExpression:matches([object.property.name="Date"], [object.property.value="Date"], [object.property.name="performance"], [object.property.value="performance"]):matches([property.name="now"], [property.value="now"])',
        'ImportDeclaration[source.value=/^(node:)?timers(\\/promises)?$/] > ImportSpecifier[imported.name=/^set(Timeout|Interval)$/]',
      )],
    },
  },
];
