const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const dataDirectory =
  process.env.EDC_DATA_DIR || path.join(process.cwd(), 'data')

const databasePath = path.join(dataDirectory, 'edc.sqlite')
const templatePath = path.join(process.cwd(), 'data', 'edc-hospital-template.sqlite')

fs.mkdirSync(dataDirectory, { recursive: true })

if (!fs.existsSync(databasePath)) {
  if (!fs.existsSync(templatePath)) {
    console.error('병원용 초기 DB를 찾을 수 없습니다.')
    console.error(`초기 DB 위치: ${templatePath}`)
    process.exit(1)
  }

  fs.copyFileSync(templatePath, databasePath)
  console.log('병원용 초기 DB를 생성했습니다.')
} else {
  console.log('기존 병원 DB를 사용합니다.')
}

const child = spawn('npm', ['run', 'start'], {
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})