import fs from 'fs'
import path from 'path'
import child_process from 'node:child_process'
import { describe, expect, it, test } from 'bun:test'

const CASES_DIR = path.join(__dirname, 'clawr-cases')
const OUTPUT_DIR = path.join(__dirname, 'out')

describe('End-to-end Tests', () => {
    const cases = fs
        .readdirSync(CASES_DIR, { withFileTypes: true })
        .map((f) => f.name)
        .filter((n) => n.endsWith('.clawr'))

    for (const fileName of cases) {
        test(fileName, async () => {
            const filePath = `${CASES_DIR}/${fileName}`
            const outFilePath = `${CASES_DIR}/${fileName.replace(/.clawr$/, '.out')}`
            const errFilePath = `${CASES_DIR}/${fileName.replace(/.clawr$/, '.err')}`
            const exePath = `${OUTPUT_DIR}/${fileName.replace(/.clawr$/, '')}`

            const compilerResult = await runCli(filePath)
            expect(compilerResult.stdout).toBe('')
            if (fs.existsSync(errFilePath)) {
                const data = fs.readFileSync(errFilePath, 'utf-8')
                expect(compilerResult).toMatchObject({
                    code: 1,
                    stderr: data,
                })
            } else {
                expect(compilerResult).toMatchObject({
                    code: 0,
                    stderr: '',
                })
            }

            const exeResult = await exec(exePath, [])
            expect(exeResult).toMatchObject({
                code: 0,
                stderr: '',
            })
            if (fs.existsSync(outFilePath)) {
                const data = fs.readFileSync(outFilePath, 'utf-8')
                expect(exeResult.stdout).toBe(data)
            }
        })
    }
})

async function runCli(filePath: string) {
    return await exec('./dist/rwrc', ['build', filePath, '-o', OUTPUT_DIR])
}

async function exec(command: string, args: string[]) {
    return await new Promise<ExecResult>((resolve) => {
        const proc = child_process.spawn(command, args)

        let stdout = ''
        let stderr = ''

        proc.stdout!!.on('data', (data) => {
            stdout += data.toString()
        })

        proc.stderr!!.on('data', (data) => {
            stderr += data.toString()
        })

        proc.on('close', (x) => {
            resolve({
                code: x ?? -1,
                stderr,
                stdout,
            })
        })
    })
}

type ExecResult = {
    code: number
    stdout: string
    stderr: string
}
