import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MODULE_DIR = join(dirname(__filename), '..')
const FORBIDDEN_PAYLOAD_FIELDS = new Set([
  'raw', 'body', 'subject', 'address', 'filename', 'attachmentId', 'url',
  'download', 'ocr', 'bytes', 'base64', 'content', 'contentBytes',
])
const DANGEROUS_CALLS = new Set([
  'fetch', 'request', 'connect', 'createConnection', 'createClient', 'readFile',
  'readFileSync', 'writeFile', 'writeFileSync', 'open', 'query', 'select',
  'insert', 'update', 'upsert', 'delete', 'rpc', 'send', 'reply', 'forward',
  'publish', 'execute', 'mutate',
])
const FORBIDDEN_CONSTRUCTORS = new Set(['WebSocket', 'EventSource', 'XMLHttpRequest'])

interface ArchitectureViolations {
  readonly nonLocalImports: string[]
  readonly dynamicLoads: string[]
  readonly dangerousCalls: string[]
}

function runtimeFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : runtimeFilesUnder(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

function sourceFileOf(path: string): ts.SourceFile {
  return sourceFileFromText(path, readFileSync(path, 'utf8'))
}

function sourceFileFromText(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function architectureViolationsOf(sourceFile: ts.SourceFile): ArchitectureViolations {
  const violations: ArchitectureViolations = {
    nonLocalImports: [],
    dynamicLoads: [],
    dangerousCalls: [],
  }
  const aliases = new Set<string>()
  const visit = (node: ts.Node): void => {
    collectDangerousAlias(node, aliases)
    collectModuleViolation(node, sourceFile, violations)
    collectCallViolation(node, sourceFile, violations, aliases)
    collectNewViolation(node, sourceFile, violations)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

function collectDangerousAlias(node: ts.Node, aliases: Set<string>): void {
  if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) return
  const target = calledNameOf(node.initializer as ts.LeftHandSideExpression)
  if (target && (DANGEROUS_CALLS.has(target) || aliases.has(target))) aliases.add(node.name.text)
}

function collectModuleViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: ArchitectureViolations,
): void {
  if (ts.isImportEqualsDeclaration(node)) {
    violations.nonLocalImports.push(node.getText(sourceFile))
    return
  }
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return
  const imported = node.moduleSpecifier.text
  const target = resolve(dirname(sourceFile.fileName), imported)
  if (!imported.startsWith('.') || !target.startsWith(`${MODULE_DIR}/`)) {
    violations.nonLocalImports.push(imported)
  }
}

function collectNewViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: ArchitectureViolations,
): void {
  if (!ts.isNewExpression(node)) return
  const name = calledNameOf(node.expression)
  if (name && FORBIDDEN_CONSTRUCTORS.has(name)) {
    violations.dangerousCalls.push(node.getText(sourceFile))
  }
}

function collectCallViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: ArchitectureViolations,
  aliases: ReadonlySet<string>,
): void {
  if (!ts.isCallExpression(node)) return
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    violations.dynamicLoads.push(node.getText(sourceFile))
    return
  }
  const callName = calledNameOf(node.expression)
  if (callName === 'require') violations.dynamicLoads.push(node.getText(sourceFile))
  if (callName && (DANGEROUS_CALLS.has(callName) || aliases.has(callName))) {
    violations.dangerousCalls.push(node.getText(sourceFile))
  }
}

function calledNameOf(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return null
}

function propertyNamesOf(sourceFile: ts.SourceFile): string[] {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (isNamedPayloadNode(node) && node.name) {
      names.push(node.name.getText(sourceFile).replaceAll(/['"]/g, ''))
    }
    if (ts.isBindingElement(node)) {
      names.push(node.propertyName?.getText(sourceFile) ?? node.name.getText(sourceFile))
    }
    if (ts.isMappedTypeNode(node)) names.push(node.typeParameter.name.getText(sourceFile))
    if (ts.isIndexSignatureDeclaration(node) && node.parameters[0]) {
      names.push(node.parameters[0].name.getText(sourceFile))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function isNamedPayloadNode(node: ts.Node): node is ts.NamedDeclaration {
  return ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)
    || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
    || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isIndexSignatureDeclaration(node)
}

describe('mailbox evidence architecture boundary', () => {
  const runtimeFiles = runtimeFilesUnder(MODULE_DIR)

  it('recursively permits only static imports inside this pure module', () => {
    for (const path of runtimeFiles) {
      const violations = architectureViolationsOf(sourceFileOf(path))
      expect(violations.nonLocalImports, basename(path)).toEqual([])
      expect(violations.dynamicLoads, basename(path)).toEqual([])
    }
  })

  it('exposes no sensitive payload or attachment-content fields', () => {
    for (const path of runtimeFiles) {
      const propertyNames = propertyNamesOf(sourceFileOf(path))
      expect(propertyNames.filter(name => FORBIDDEN_PAYLOAD_FIELDS.has(name)), basename(path)).toEqual([])
    }
  })

  it('contains no I/O, provider, persistence or mutation calls', () => {
    for (const path of runtimeFiles) {
      const violations = architectureViolationsOf(sourceFileOf(path))
      expect(violations.dangerousCalls, basename(path)).toEqual([])
    }
  })

  it.each([
    ['dynamic import', 'void import("./internal/reader")', 'dynamicLoads'],
    ['require', 'require("node:fs")', 'dynamicLoads'],
    ['global fetch', 'globalThis.fetch("https://example.test")', 'dangerousCalls'],
    ['computed I/O', 'storage["readFileSync"]("secret")', 'dangerousCalls'],
    ['import equals', 'import fs = require("node:fs")', 'nonLocalImports'],
    ['network constructor', 'new WebSocket("wss://example.test")', 'dangerousCalls'],
    ['aliased call', 'const load = fetch; load("https://example.test")', 'dangerousCalls'],
  ] as const)('detects the %s bypass probe', (_name, source, violationKind) => {
    const probe = sourceFileFromText(join(MODULE_DIR, 'probe.ts'), source)
    expect(architectureViolationsOf(probe)[violationKind]).not.toEqual([])
  })

  it.each([
    ['object property', 'const value = { body: "secret" }'],
    ['destructuring', 'const { contentBytes } = value'],
    ['method', 'class Value { attachmentId() {} }'],
    ['accessor', 'class Value { get filename() { return "x" } }'],
    ['mapped field', 'type Value = { [body in "body"]: string }'],
    ['indexed field', 'interface Value { [content: string]: string }'],
  ])('detects the %s payload probe', (_name, source) => {
    const probe = sourceFileFromText(join(MODULE_DIR, 'probe.ts'), source)
    expect(propertyNamesOf(probe).filter(name => FORBIDDEN_PAYLOAD_FIELDS.has(name))).not.toEqual([])
  })
})
