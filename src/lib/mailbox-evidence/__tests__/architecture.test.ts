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
  const visit = (node: ts.Node): void => {
    collectModuleViolation(node, sourceFile, violations)
    collectCallViolation(node, sourceFile, violations)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

function collectModuleViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: ArchitectureViolations,
): void {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return
  const imported = node.moduleSpecifier.text
  const target = resolve(dirname(sourceFile.fileName), imported)
  if (!imported.startsWith('.') || !target.startsWith(`${MODULE_DIR}/`)) {
    violations.nonLocalImports.push(imported)
  }
}

function collectCallViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: ArchitectureViolations,
): void {
  if (!ts.isCallExpression(node)) return
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    violations.dynamicLoads.push(node.getText(sourceFile))
    return
  }
  const callName = calledNameOf(node.expression)
  if (callName === 'require') violations.dynamicLoads.push(node.getText(sourceFile))
  if (callName && DANGEROUS_CALLS.has(callName)) {
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
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.name) {
      names.push(node.name.getText(sourceFile).replaceAll(/['"]/g, ''))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
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
  ] as const)('detects the %s bypass probe', (_name, source, violationKind) => {
    const probe = sourceFileFromText(join(MODULE_DIR, 'probe.ts'), source)
    expect(architectureViolationsOf(probe)[violationKind]).not.toEqual([])
  })
})
