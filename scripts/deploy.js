import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const sourceDir = '/Users/hile/Documents/work/projects/X'
const targetDir = '/Users/hile/Documents/work/projects/X-PR'

// PR 环境 MySQL 配置（与开发环境共用同一 MySQL 实例，但使用同一业务数据库 quote_system）
// 注意：开发环境(3001)和 PR 环境(3002)共享 quote_system 数据库，由 NODE_ENV 区分行为
const MYSQL_HOST = '127.0.0.1'
const MYSQL_PORT = '3306'
const MYSQL_USER = 'root'
const MYSQL_PASSWORD = ''
const MYSQL_DATABASE = 'quote_system'

console.log('============================================')
console.log('  Production Deployment via Node.js')
console.log('  Database: MySQL (mysql2/promise)')
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

// Step 1: Backup MySQL database via mysqldump
console.log('[1/6] Backing up MySQL database...')
const backupDir = path.join(targetDir, 'data', 'backup', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirp(backupDir)
const dumpFile = path.join(backupDir, `${MYSQL_DATABASE}.sql`)
try {
  const passwordArg = MYSQL_PASSWORD ? `-p${MYSQL_PASSWORD}` : ''
  execSync(
    `mysqldump -h ${MYSQL_HOST} -P ${MYSQL_PORT} -u ${MYSQL_USER} ${passwordArg} ${MYSQL_DATABASE} > "${dumpFile}"`,
    { stdio: 'pipe' }
  )
  console.log(`      Database backed up to ${path.basename(dumpFile)}`)
} catch (err) {
  console.warn('      [WARN] mysqldump failed (non-fatal):', err.message.split('\n')[0])
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

// Create .env with MySQL configuration
const envProd = path.join(targetDir, '.env.production')
const envFile = path.join(targetDir, '.env')
const envContent = [
  `PORT=3002`,
  `MYSQL_HOST=${MYSQL_HOST}`,
  `MYSQL_PORT=${MYSQL_PORT}`,
  `MYSQL_USER=${MYSQL_USER}`,
  `MYSQL_PASSWORD=${MYSQL_PASSWORD}`,
  `MYSQL_DATABASE=${MYSQL_DATABASE}`,
  `NODE_ENV=production`,
  `EXPORT_STORAGE_PATH=./exports`,
  `# HOST 留空 = 绑定所有接口（支持外部访问）`,
  ``,
].join('\n')

if (fs.existsSync(envProd)) {
  fs.copyFileSync(envProd, envFile)
  console.log('      .env copied from .env.production')
} else if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, envContent)
  console.log('      .env created with MySQL config')
} else {
  // 已存在 .env，仅在其未包含 MYSQL_* 配置时追加（避免覆盖用户自定义配置）
  const existing = fs.readFileSync(envFile, 'utf8')
  if (!existing.includes('MYSQL_HOST')) {
    fs.writeFileSync(envFile, envContent)
    console.log('      .env overwritten with MySQL config (old SQLite config detected)')
  } else {
    console.log('      .env already contains MySQL config (kept as-is)')
  }
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
console.log('  Database: MySQL')
console.log(`    Host: ${MYSQL_HOST}:${MYSQL_PORT}`)
console.log(`    DB:   ${MYSQL_DATABASE}`)
console.log()
console.log('  Next steps:')
console.log('  1. cd X-PR')
console.log('  2. npm install')
console.log('  3. bash scripts/restart.sh   # 启动 + 健康检查 + schema 迁移')
console.log()
