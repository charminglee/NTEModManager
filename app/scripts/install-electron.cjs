const path = require('path')
const fs = require('fs')
const { downloadArtifact } = require('@electron/get')
const extract = require('extract-zip')

async function main() {
  const zip = await downloadArtifact({
    version: '33.4.11',
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64'
  })
  console.log('using', zip)
  const dist = path.join(process.cwd(), 'node_modules', 'electron', 'dist')
  await extract(zip, { dir: dist })
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'electron', 'path.txt'), 'electron.exe')
  console.log('EXTRACT_OK')
}

main().catch((e) => {
  console.error('ERR:', e.message)
  process.exit(1)
})
