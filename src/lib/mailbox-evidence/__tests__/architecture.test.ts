import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MODULE_DIR = join(dirname(__filename), '..')
const RUNTIME_FILES = readdirSync(MODULE_DIR)
  .filter(file => file.endsWith('.ts'))
  .map(file => join(MODULE_DIR, file))

const FORBIDDEN_IMPORTS = [
  'supabase', 'database', 'microsoft', 'gmail', 'oauth', 'openai', 'anthropic',
  'llm', 'fetch', 'axios', 'undici', 'kernel', 'flywheel', 'crm',
]

const FORBIDDEN_PAYLOAD_FIELDS = new Set([
  'raw', 'body', 'subject', 'address', 'filename', 'attachmentId', 'url',
  'download', 'ocr', 'bytes', 'base64', 'content', 'contentBytes',
])

function sourceFileOf(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
}

function importsOf(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return []
    return statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : []
  })
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
  it('imports only its own pure local modules', () => {
    for (const path of RUNTIME_FILES) {
      for (const imported of importsOf(sourceFileOf(path))) {
        expect(FORBIDDEN_IMPORTS.some(value => imported.toLowerCase().includes(value)),
          `${basename(path)} imports forbidden dependency ${imported}`).toBe(false)
        expect(imported.startsWith('.'), `${basename(path)} has non-local import ${imported}`).toBe(true)
      }
    }
  })

  it('exposes no sensitive payload or attachment-content fields', () => {
    for (const path of RUNTIME_FILES) {
      const propertyNames = propertyNamesOf(sourceFileOf(path))
      expect(propertyNames.filter(name => FORBIDDEN_PAYLOAD_FIELDS.has(name)), basename(path)).toEqual([])
    }
  })

  it('contains no I/O or mutation calls', () => {
    const source = RUNTIME_FILES.map(path => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/\b(fetch|axios|createClient|from|insert|update|upsert|delete|rpc)\s*\(/)
    expect(source).not.toMatch(/\b(send|reply|forward|publish|execute|mutate)\s*\(/)
  })
})
