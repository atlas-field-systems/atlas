import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@typescript-eslint/parser';
import typescript from '@typescript-eslint/eslint-plugin';

const root = fileURLToPath(new URL('.', import.meta.url));
const parts = {
  protocol: [],
  core: ['protocol(?:/|$)'],
  sdk: ['protocol(?:/|$)', 'core/event-(?:kinds|frame)$'],
  asset: ['sdk(?:/|$)', 'protocol(?:/|$)'],
  simulations: null,
};
const partFiles = part => `${part}/**/*.{ts,mts,cts,js,mjs,cjs}`;

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
    { files: ['asset/test/**/*.{ts,mts,cts,js,mjs,cjs}'], flight: true },
    { files: ['asset/src/**/*.{ts,mts,cts,js,mjs,cjs}'], ignores: ['asset/src/ardupilot.ts'], zod: true },
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

const runtime = ['core', 'sdk', 'asset'].map(part => `${part}/src/**/*.{ts,mts,cts,js,mjs,cjs}`);
const syntax = (message, ...selectors) => selectors.map(selector => ({ selector, message }));
const rejectionHandlers = ['catch', 'then'].map((method, index) =>
  `CallExpression:matches([callee.property.name="${method}"], [callee.property.value="${method}"]) > .arguments:nth-child(${index + 1}):matches(ArrowFunctionExpression, FunctionExpression)`,
);
const constant = ':matches(Literal, Identifier[name=/^(undefined|NaN|Infinity)$/], TemplateLiteral[expressions.length=0], UnaryExpression[operator="void"]:matches([argument.type="Literal"], [argument.type="Identifier"][argument.name="undefined"]))';
const catchRestrictions = syntax(messages.catch,
  'CatchClause[body.body.length=0]',
  'CatchClause[body.body.length=1][body.body.0.type="ReturnStatement"][body.body.0.argument=null]',
  `CatchClause > BlockStatement.body[body.length=1] > ReturnStatement > .argument${constant}`,
  ...rejectionHandlers.flatMap(handler => [
    `${handler} > .body${constant}`,
    `${handler} > BlockStatement.body[body.length=0]`,
    `${handler} > BlockStatement.body[body.length=1] > ReturnStatement[argument=null]`,
    `${handler} > BlockStatement.body[body.length=1] > ReturnStatement > .argument${constant}`,
  ]),
);
const timers = String.raw`/^(node:)?timers(\/promises)?$/`;
const timersSource = `:matches(Literal[value=${timers}], TemplateLiteral[expressions.length=0][quasis.0.value.cooked=${timers}])`;

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
        terms: ['todo', 'fixme', 'hack', 'workaround', 'for now', 'xxx', 'kludge'],
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
    files: [...runtime, 'protocol/lib/**/*.{ts,mts,cts,js,mjs,cjs}', 'protocol/cli/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: { 'no-restricted-syntax': ['error', ...catchRestrictions] },
  },
  {
    files: runtime,
    ignores: ['core/src/clock.ts', 'sdk/src/clock.ts'],
    languageOptions: { globals: { global: 'readonly' } },
    rules: {
      'no-restricted-globals': ['error', {
        globals: ['setTimeout', 'setInterval'].map(name => ({ name, message: messages.clock })),
        checkGlobalObject: true,
        globalObjects: ['global'],
      }],
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: messages.clock },
        { object: 'performance', property: 'now', message: messages.clock },
        { object: 'process', property: 'hrtime', message: messages.clock },
        { object: 'process', property: 'uptime', message: messages.clock },
      ],
      'no-restricted-syntax': ['error', ...catchRestrictions, ...syntax(messages.clock,
        ':matches(NewExpression[arguments.length=0], CallExpression):matches([callee.name="Date"], [callee.property.name="Date"], [callee.property.value="Date"])',
        'MemberExpression:matches([object.property.name="Date"], [object.property.value="Date"], [object.property.name="performance"], [object.property.value="performance"]):matches([property.name="now"], [property.value="now"])',
        'MemberExpression:matches([object.property.name="process"], [object.property.value="process"]):matches([property.name="hrtime"], [property.name="uptime"], [property.value="hrtime"], [property.value="uptime"])',
        'ImportDeclaration[source.value=/^(node:)?process$/] > ImportSpecifier[imported.name=/^(hrtime|uptime)$/]',
        'MemberExpression:matches([object.name="AbortSignal"], [object.property.name="AbortSignal"], [object.property.value="AbortSignal"]):matches([property.name="timeout"], [property.value="timeout"])',
        'MemberExpression:matches([object.name="scheduler"], [object.property.name="scheduler"], [object.property.value="scheduler"]):matches([property.name="wait"], [property.value="wait"])',
        ':matches(VariableDeclarator[init.name=/^global(This)?$/] > ObjectPattern.id, AssignmentExpression[right.name=/^global(This)?$/] > ObjectPattern.left) > Property:matches([key.name=/^set(Timeout|Interval)$/], [key.value=/^set(Timeout|Interval)$/])',
        `:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > .source${timersSource}`,
        `TSExternalModuleReference > .expression${timersSource}`,
        `CallExpression[callee.name="require"] > .arguments:nth-child(1)${timersSource}`,
      )],
    },
  },
];
