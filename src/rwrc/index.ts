#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import child_process from 'node:child_process'
import { Command } from 'commander'
import { glob } from 'fast-glob'
import { parseClawr } from '../parser'
import {
    analyzeProgram,
    type SemanticDiagnostic,
    type SemanticProgram,
} from '../semantics'
import { lowerToCIr } from '../codegen'
import { emitC } from '../ir/c'
import { optimizeCIr } from '../optimizer'

const cli = new Command()

cli.name('rwrc')
    .description('Clawr prototype compiler')
    .command('build')
    .argument('<sourceFile>', 'path to .clawr source file')
    .option('-o, --outdir <dir>', 'directory for output executable', '.')
    .action(async (sourceFile: string, options: { outdir: string }) => {
        try {
            await buildCommand(sourceFile, options.outdir)
        } catch (error) {
            process.stderr.write(`${toMessage(error)}\n`)
            process.exitCode = 1
        }
    })

cli.parseAsync(process.argv)

async function buildCommand(sourceFile: string, outDir: string) {
    const absoluteSourcePath = path.resolve(process.cwd(), sourceFile)
    const source = fs.readFileSync(absoluteSourcePath, 'utf-8')
    const ast = parseClawr(source, absoluteSourcePath)
    const semanticProgram: SemanticProgram = analyzeProgram(ast)
    if (semanticProgram.diagnostics.length > 0) {
        const message = semanticProgram.diagnostics
            .map(
                (diagnostic: SemanticDiagnostic) =>
                    `${diagnostic.position.file}:${diagnostic.position.line}:${diagnostic.position.column}-${diagnostic.position.endLine}:${diagnostic.position.endColumn}:semantic: ${diagnostic.message}`,
            )
            .join('\n')
        throw new Error(message)
    }
    const loweredIr = lowerToCIr(ast, {
        returnsRequiringNormalization:
            semanticProgram.returnsRequiringNormalization,
    })
    const optimizedIr = optimizeCIr(loweredIr)
    const generatedC = emitC(optimizedIr)

    const outputDirectory = path.resolve(process.cwd(), outDir)
    fs.mkdirSync(outputDirectory, { recursive: true })

    const baseName = path.basename(absoluteSourcePath).replace(/\.clawr$/, '')
    const generatedCPath = path.join(outputDirectory, `${baseName}.generated.c`)
    const executablePath = path.join(outputDirectory, baseName)
    fs.writeFileSync(generatedCPath, generatedC)

    const runtimeDir = path.resolve(process.cwd(), 'src/runtime')
    const runtimeSources = await glob(path.join(runtimeDir, '*.c'))
    if (runtimeSources.length === 0)
        throw new Error(`No runtime C sources found in ${runtimeDir}`)

    const result = await exec('clang', [
        '-I',
        path.join(runtimeDir, 'include'),
        generatedCPath,
        ...runtimeSources,
        '-o',
        executablePath,
    ])

    if (result.code !== 0) {
        throw new Error(
            result.stderr || `clang failed with exit code ${result.code}`,
        )
    }
}

async function exec(command: string, args: string[]) {
    return await new Promise<ExecResult>((resolve) => {
        const proc = child_process.spawn(command, args)

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
            stdout += data.toString()
        })

        proc.stderr?.on('data', (data) => {
            stderr += data.toString()
        })

        proc.on('close', (code) => {
            resolve({
                code: code ?? -1,
                stdout,
                stderr,
            })
        })
    })
}

function toMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

type ExecResult = {
    code: number
    stdout: string
    stderr: string
}
