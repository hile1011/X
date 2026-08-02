import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const sourceDir = '/Users/hile/Documents/work/projects/X'
const targetDir = '/Users/hile/Documents/work/projects/X-PR'

console.log('============================================')
console.log('  Production Deployment via Node.js')
console.log('============================================')
console.log()

const mkdirp = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const copyDir = (src, dst, exclude = []) => {
  if (!fs.existsSync(src)) return
  mkdirp(dst)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const dstPath = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath, exclude)
    } else {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

const copyFile = (src, dst) => {
  if (fs.existsSync(src)) {
    mkdirp(path.dirname(dst))
    fs.copyFileSync(src, dst)
    return true
  }
  return false
}

// Step 1: Backup
console.log('[1/6] Backing up existing data...')
const backupDir = path.join(targetDir, 'data', 'backup', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirp(backupDir)
const dbFile = path.join(targetDir, 'data', 'quote-system.db')
if (fs.existsSync(dbFile)) {
  fs.copyFileSync(dbFile, path.join(backupDir, 'quote-system.db'))
  console.log('      Database backed up')
}
console.log('      Done')

// Step 2: Copy API source
console.log('\n[2/6] Copying API source...')
copyDir(path.join(sourceDir, 'api'), path.join(targetDir, 'api'), ['node_modules', 'dist', '.env', '*.log'])
console.log('      API source copied')

// Step 3: Copy frontend source
console.log('[3/6] Copying frontend source...')
copyDir(path.join(sourceDir, 'src'), path.join(targetDir, 'src'), ['node_modules', 'dist'])
copyFile(path.join(sourceDir, 'index.html'), path.join(targetDir, 'index.html'))
copyFile(path.join(sourceDir, 'vite.config.ts'), path.join(targetDir, 'vite.config.ts'))
copyFile(path.join(sourceDir, 'postcss.config.js'), path.join(targetDir, 'postcss.config.js'))
copyFile(path.join(sourceDir, 'tailwind.config.js'), path.join(targetDir, 'tailwind.config.js'))
console.log('      Frontend source copied')

// Step 4: Copy build artifacts
console.log('[4/6] Copying build artifacts...')
copyDir(path.join(sourceDir, 'dist'), path.join(targetDir, 'dist'))
copyDir(path.join(sourceDir, 'api', 'dist'), path.join(targetDir, 'api', 'dist'))
console.log('      Build artifacts copied')

// Step 5: Copy config files
console.log('[5/6] Setting up config...')
copyFile(path.join(sourceDir, 'package.json'), path.join(targetDir, 'package.json'))

// Create .env from .env.production
const envProd = path.join(targetDir, '.env.production')
const envFile = path.join(targetDir, '.env')
if (fs.existsSync(envProd)) {
  fs.copyFileSync(envProd, envFile)
} else if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, 'PORT=3001\nDB_PATH=./data/quote-system.db\nNODE_ENV=production\nEXPORT_STORAGE_PATH=./exports\n')
}
console.log('      Config setup done')

// Step 6: Ensure directories
console.log('[6/6] Setting up directories...')
mkdirp(path.join(targetDir, 'data', 'uploads'))
mkdirp(path.join(targetDir, 'data', 'logs'))
mkdirp(path.join(targetDir, 'exports'))
mkdirp(path.join(targetDir, 'scripts'))
console.log('      Done')

console.log('\n============================================')
console.log('  Files deployed to X-PR successfully!')
console.log('============================================')
console.log()
console.log('  Next steps:')
console.log('  1. cd X-PR')
console.log('  2. npm install')
console.log('  3. node -e "setup_migration.js"')
console.log('  4. node api/dist/index.js')
console.log()
