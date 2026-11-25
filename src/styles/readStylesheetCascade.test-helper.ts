import { readFileSync } from 'node:fs'

const ownedModuleImport = /^@import '\.\/styles\/([^']+\.css)';$/

export function readStylesheetCascade() {
  const entry = readFileSync('src/styles.css', 'utf8')
  const importLines = entry.trimEnd().split(/\r?\n/)

  return importLines.map((line) => {
    const match = line.match(ownedModuleImport)
    if (!match) throw new Error(`Unexpected stylesheet entry line: ${line}`)
    return readFileSync(`src/styles/${match[1]}`, 'utf8')
  }).join('')
}
