/**
 * start.js — 基于 Node.js 的环境启动脚本
 *
 * 用法：
 *   node scripts/start.js --env <development|test|production> [选项]
 *
 * 选项：
 *   --env, -e <env>    指定环境（必填）
 *   --backend-only     仅启动后端
 *   --frontend-only    仅启动前端（仅 development 模式）
 *   --help, -h         显示帮助
 *
 * 功能：
 *   1. 解析 --env 参数，校验环境名称
 *   2. 动态加载 environments/<env>.config.js 配置文件
 *   3. 将配置注入 process.env（覆盖 api/.env 默认值）
 *   4. 预检查（端口占用、PID 残留、构建产物存在性）
 *   5. 启动后端服务（dev: tsx watch / prod: node dist）
 *   6. 健康检查（轮询 /api/health）
 *   7. 启动前端开发服务器（仅 development 模式）
 *   8. 信号处理（SIGINT/SIGTERM 优雅关闭子进程）
 */
import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

// 直接使用 node_modules/.bin 下的二进制路径，避免 npx 包装器改变 cwd
const TSX_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx')
const VITE_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'vite')

// ============================================================
// 颜色输出工具
// ============================================================
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

const log = {
  info: (msg) => console.log(`${C.cyan}ℹ${C.reset}  ${msg}`),
  ok: (msg) => console.log(`${C.green}✓${C.reset}  ${msg}`),
  warn: (msg) => console.log(`${C.yellow}⚠${C.reset}  ${msg}`),
  error: (msg) => console.error(`${C.red}✗${C.reset}  ${msg}`),
  step: (msg) => console.log(`\n${C.bold}▶ ${msg}${C.reset}`),
  dim: (msg) => console.log(`${C.dim}   ${msg}${C.reset}`),
}

// ============================================================
// 参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2)
  const parsed = {
    env: null,
    backendOnly: false,
    frontendOnly: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--env':
      case '-e':
        parsed.env = args[++i]
        break
      case '--backend-only':
      case '-b':
        parsed.backendOnly = true
        break
      case '--frontend-only':
      case '-f':
        parsed.frontendOnly = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        log.error(`未知选项: ${args[i]}`)
        printHelp()
        process.exit(1)
    }
  }

  return parsed
}

function printHelp() {
  console.log(`
${C.bold}start.js — 环境启动脚本${C.reset}

用法:
  node scripts/start.js --env <environment> [选项]

选项:
  -e, --env <env>        指定环境: development | test | production（必填）
  -b, --backend-only     仅启动后端服务
  -f, --frontend-only    仅启动前端开发服务器（仅 development 模式）
  -h, --help             显示此帮助

示例:
  node scripts/start.js --env development          # 启动开发环境（前后端）
  node scripts/start.js --env development -b        # 仅启动后端
  node scripts/start.js --env test                  # 启动测试环境
  node scripts/start.js --env production            # 启动生产环境（冒烟测试）

可用环境配置:
  environments/development.config.js
  environments/test.config.js
  environments/production.config.js
`)
}

// ============================================================
// 配置加载
// ============================================================
const VALID_ENVS = ['development', 'test', 'production']

function loadConfig(envName) {
  // 参数校验：未指定环境
  if (!envName) {
    log.error('未指定环境，请使用 --env <environment> 参数')
    console.log(`   可用环境: ${VALID_ENVS.join(', ')}`)
    console.log(`   示例: node scripts/start.js --env development`)
    process.exit(1)
  }

  // 参数校验：环境不存在
  if (!VALID_ENVS.includes(envName)) {
    log.error(`不存在的环境: "${envName}"`)
    console.log(`   可用环境: ${VALID_ENVS.join(', ')}`)
    process.exit(1)
  }

  // 动态加载配置文件
  const configPath = join(PROJECT_ROOT, 'environments', `${envName}.config.js`)
  if (!existsSync(configPath)) {
    log.error(`配置文件不存在: ${configPath}`)
    process.exit(1)
  }

  try {
    const configUrl = new URL(`file://${configPath}`)
    return import(configUrl.href).then((m) => m.default)
  } catch (err) {
    log.error(`加载配置文件失败: ${configPath}`)
    console.error(`   ${err.message}`)
    process.exit(1)
  }
}

// ============================================================
// 环境变量注入
// ============================================================
function applyEnvVars(config) {
  process.env.NODE_ENV = config.nodeEnv
  process.env.PORT = String(config.backend.port)
  process.env.MYSQL_HOST = config.database.host
  process.env.MYSQL_PORT = String(config.database.port)
  process.env.MYSQL_USER = config.database.user
  process.env.MYSQL_PASSWORD = config.database.password || ''
  process.env.MYSQL_DATABASE = config.database.name
  process.env.EXPORT_STORAGE_PATH = resolve(PROJECT_ROOT, config.paths.exportDir)
  if (config.backend.host) {
    process.env.HOST = config.backend.host
  }
}

// ============================================================
// 路径辅助
// ============================================================
function resolvePath(config, key) {
  return resolve(PROJECT_ROOT, config.paths[key])
}

function getPidFile(config) {
  return resolve(PROJECT_ROOT, config.paths.pidFile)
}

// ============================================================
// 端口检查
// ============================================================
function isPortListening(port) {
  try {
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function findPortPid(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' })
    return out.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

// ============================================================
// PID 文件管理
// ============================================================
function pidWrite(config, pid) {
  writeFileSync(getPidFile(config), String(pid))
}

function pidRead(config) {
  const file = getPidFile(config)
  if (!existsSync(file)) return null
  const pid = parseInt(readFileSync(file, 'utf8').trim(), 10)
  return isNaN(pid) ? null : pid
}

function pidClear(config) {
  const file = getPidFile(config)
  if (existsSync(file)) unlinkSync(file)
}

function pidIsRunning(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ============================================================
// 日志辅助
// ============================================================
function getBackendLogFile(config) {
  const logDir = resolvePath(config, 'logDir')
  const envShort = config.name === 'development' ? 'dev' : config.name === 'production' ? 'prod' : 'test'
  return join(logDir, `app-${envShort}.log`)
}

function getFrontendLogFile(config) {
  const logDir = resolvePath(config, 'logDir')
  return join(logDir, 'app-dev-frontend.log')
}

function appendLog(filePath, line) {
  try {
    appendFileSync(filePath, line + '\n')
  } catch {
    // 忽略日志写入失败
  }
}

// ============================================================
// 健康检查
// ============================================================
async function healthCheck(port, timeoutSec) {
  const url = `http://localhost:${port}/api/health`
  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (resp.ok) {
        const body = await resp.json()
        return body
      }
    } catch {
      // 服务尚未就绪，继续轮询
    }
    await sleep(1000)
  }
  return null
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ============================================================
// 进程管理
// ============================================================
const children = []

function killAllChildren() {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
}

// 优雅关闭
let shuttingDown = false
function gracefulShutdown(config, reason) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n${C.yellow}⚠${C.reset}  正在停止服务 (${reason})...`)
  killAllChildren()
  pidClear(config)
  // 给子进程 2 秒优雅退出，然后强制
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
    process.exit(0)
  }, 2000)
}

// ============================================================
// 预检查
// ============================================================
function precheck(config, opts) {
  log.step('预检查')
  let ok = true

  // 端口占用检查
  if (!opts.frontendOnly && isPortListening(config.backend.port)) {
    const pid = findPortPid(config.backend.port)
    log.warn(`后端端口 ${config.backend.port} 已被占用 (PID: ${pid || '未知'})`)
    ok = false
  }

  if (
    config.mode === 'development' &&
    !opts.backendOnly &&
    isPortListening(config.frontend.port)
  ) {
    log.warn(`前端端口 ${config.frontend.port} 已被占用`)
    ok = false
  }

  // PID 文件残留检查
  const existingPid = pidRead(config)
  if (existingPid && pidIsRunning(existingPid)) {
    log.warn(`检测到已有运行中的服务 (PID: ${existingPid})`)
    ok = false
  } else {
    pidClear(config)
  }

  // 生产模式检查构建产物
  if (config.mode === 'production' && !opts.frontendOnly) {
    const distPath = join(PROJECT_ROOT, 'api', 'dist', 'index.js')
    if (!existsSync(distPath)) {
      log.error(`构建产物不存在: api/dist/index.js`)
      log.info(`请先执行: npm run build`)
      process.exit(1)
    }
  }

  if (!ok) {
    log.error('预检查失败，请先停止现有服务')
    log.dim(`提示: node scripts/stop.js --env ${config.name}  或  bash scripts/stop.sh -e ${config.name === 'development' ? 'dev' : config.name === 'production' ? 'prod' : 'test'}`)
    process.exit(1)
  }

  log.ok('预检查通过')
}

// ============================================================
// 启动后端
// ============================================================
async function startBackend(config) {
  log.step(`启动后端服务 (端口: ${config.backend.port})`)

  const logFile = getBackendLogFile(config)
  mkdirSync(dirname(logFile), { recursive: true })

  const isDev = config.mode === 'development'
  log.info(`模式: ${isDev ? '开发模式 (tsx watch 热重载)' : '生产模式 (编译产物)'}`)
  log.info(`数据库: MySQL ${config.database.host}:${config.database.port}/${config.database.name}`)

  let cmd, args
  if (isDev) {
    cmd = TSX_BIN
    args = ['watch', join(PROJECT_ROOT, 'api', 'index.ts')]
  } else {
    cmd = 'node'
    args = [join(PROJECT_ROOT, 'api', 'dist', 'index.js')]
  }

  // 使用 detached + 子进程独立运行，父进程退出后子进程继续
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: PROJECT_ROOT,
    env: process.env,
  })

  // 转发输出
  child.stdout.on('data', (data) => {
    const text = data.toString()
    process.stdout.write(text)
    appendLog(logFile, text.trimEnd())
  })
  child.stderr.on('data', (data) => {
    const text = data.toString()
    process.stderr.write(text)
    appendLog(logFile, text.trimEnd())
  })

  child.on('exit', (code) => {
    if (!shuttingDown) {
      if (code !== 0 && code !== null) {
        log.error(`后端进程退出 (code: ${code})`)
      }
    }
  })

  children.push(child)
  pidWrite(config, child.pid)
  log.info(`后端启动中 (PID: ${child.pid})`)
  log.dim(`后端日志: ${logFile}`)

  // 等待端口就绪
  log.info('等待端口就绪...')
  const portDeadline = Date.now() + config.healthCheckTimeout * 1000
  let portReady = false
  while (Date.now() < portDeadline) {
    if (isPortListening(config.backend.port)) {
      portReady = true
      break
    }
    // 检查进程是否已退出
    if (child.exitCode !== null) {
      log.error('后端进程启动后立即退出')
      log.dim('查看日志: ' + logFile)
      const tail = readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n')
      if (tail) console.log(tail)
      process.exit(1)
    }
    await sleep(500)
  }

  if (portReady) {
    log.ok(`后端端口 ${config.backend.port} 监听中`)
  } else {
    log.error(`后端启动超时 — 端口 ${config.backend.port} 未就绪`)
    process.exit(1)
  }

  // 健康检查
  log.info(`健康检查 (超时: ${config.healthCheckTimeout}s)...`)
  const health = await healthCheck(config.backend.port, config.healthCheckTimeout)
  if (health) {
    log.ok(`后端健康检查通过`)
    if (health.schemaVersion) {
      log.dim(`Schema 版本: v${health.schemaVersion}`)
    }
  } else {
    log.warn('健康检查未通过（服务可能仍在初始化）')
  }
}

// ============================================================
// 启动前端
// ============================================================
async function startFrontend(config) {
  if (config.mode !== 'development') {
    log.dim('非开发模式，跳过前端开发服务器')
    return
  }

  log.step(`启动前端开发服务器 (端口: ${config.frontend.port})`)

  const logFile = getFrontendLogFile(config)
  mkdirSync(dirname(logFile), { recursive: true })

  const child = spawn(
    VITE_BIN,
    ['--port', String(config.frontend.port), '--host'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
      env: process.env,
    }
  )

  child.stdout.on('data', (data) => {
    const text = data.toString()
    process.stdout.write(text)
    appendLog(logFile, text.trimEnd())
  })
  child.stderr.on('data', (data) => {
    const text = data.toString()
    process.stderr.write(text)
    appendLog(logFile, text.trimEnd())
  })

  children.push(child)
  log.info(`前端启动中 (PID: ${child.pid})`)
  log.dim(`前端日志: ${logFile}`)

  // 等待前端端口就绪
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (isPortListening(config.frontend.port)) {
      log.ok(`前端端口 ${config.frontend.port} 监听中`)
      return
    }
    await sleep(500)
  }
  log.warn(`前端端口 ${config.frontend.port} 未就绪（可能仍在编译）`)
}

// ============================================================
// 启动总结
// ============================================================
function printSummary(config) {
  log.step('启动总结')
  log.ok(`环境: ${config.name}`)
  log.ok(`后端: http://localhost:${config.backend.port}`)
  if (config.mode === 'development') {
    log.ok(`前端: http://localhost:${config.frontend.port}`)
  }
  log.dim(`PID: ${pidRead(config) || 'N/A'}`)
  log.dim(`按 Ctrl+C 停止服务`)
  console.log()
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const opts = parseArgs()
  const config = await loadConfig(opts.env)

  // 打印环境信息
  console.log(`${C.bold}══════════════════════════════════════════════${C.reset}`)
  console.log(`${C.bold}  Quote Order System — ${config.name}${C.reset}`)
  console.log(`${C.dim}  环境: ${config.nodeEnv} | 模式: ${config.mode}${C.reset}`)
  console.log(`${C.dim}  数据库: MySQL ${config.database.host}:${config.database.port}/${config.database.name}${C.reset}`)
  console.log(`${C.bold}══════════════════════════════════════════════${C.reset}`)

  // 确保目录存在
  const dataDir = resolvePath(config, 'dataDir')
  const logDir = resolvePath(config, 'logDir')
  const exportDir = resolvePath(config, 'exportDir')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(logDir, { recursive: true })
  mkdirSync(exportDir, { recursive: true })

  // 注入环境变量
  applyEnvVars(config)

  // 仅前端模式
  if (opts.frontendOnly) {
    if (config.mode !== 'development') {
      log.error('--frontend-only 仅支持 development 环境')
      process.exit(1)
    }
    await startFrontend(config)
    log.ok(`前端已启动: http://localhost:${config.frontend.port}`)
    return
  }

  // 预检查
  precheck(config, opts)

  // 注册信号处理
  process.on('SIGINT', () => gracefulShutdown(config, 'SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown(config, 'SIGTERM'))

  // 启动后端
  await startBackend(config)

  // 启动前端
  if (!opts.backendOnly) {
    await startFrontend(config)
  }

  // 总结
  printSummary(config)
}

main().catch((err) => {
  log.error(err.message)
  console.error(err.stack)
  process.exit(1)
})
