import Decimal from 'decimal.js'
import type {
    IdentifierToken,
    KeywordToken,
    NewlineToken,
    OperatorToken,
    PunctuationToken,
    RegexLiteralToken,
    StringLiteralToken,
    Token,
} from './token'
import {
    keywords,
    operators,
    punctuationChars,
    punctuationSymbols,
    truthValues,
} from './kinds'
import type {
    Keyword,
    Operator,
    PunctuationSymbol,
    TruthLiteral,
} from './kinds'
import { positionedError } from './positioned-error'

export class TokenStream {
    private source: Source
    private file: string
    private previousToken: Token | undefined // <-- add this

    constructor(source: string | Source, file: string) {
        this.file = file
        if (typeof source == 'string') {
            this.source = new Source(source)
        } else {
            this.source = source
        }
    }

    attempt<T>(parse: (clone: TokenStream) => T): T | null {
        const clone = this.clone()
        const result = parse(clone)
        if (result) this.merge(clone)

        return result
    }

    clone() {
        const clone = new TokenStream(this.source.clone(), this.file)
        clone.previousToken = this.previousToken
        return clone
    }

    private merge(clone: TokenStream) {
        this.source.location = { ...clone.source.location }
        this.previousToken = clone.previousToken
    }

    expect(kind: 'NEWLINE'): NewlineToken
    expect(kind: 'OPERATOR', operators?: Operator[]): OperatorToken
    expect(kind: 'KEYWORD', keyword: Keyword): KeywordToken
    expect(kind: 'IDENTIFIER'): IdentifierToken
    expect(kind: 'PUNCTUATION', symbol: PunctuationSymbol): PunctuationToken
    expect(kind: Token['kind'], value?: string | string[]): Token {
        const token = this.next()

        if (!token) throw new Error(`Expected ${value ?? kind}, got EOF`)

        if (token.kind !== kind)
            throw this.positionedError(
                `Expected ${value ?? kind}, got ${token.kind}`,
                token,
            )

        if (value !== undefined) {
            if ('keyword' in token && token.keyword !== value) {
                throw this.positionedError(
                    `Unexpected keyword ${token.keyword}, expected: ${value}`,
                    token,
                )
            }

            if ('identifier' in token && token.identifier !== value) {
                throw this.positionedError(
                    `Unexpected identifier ${token.identifier}, expected: ${value}`,
                    token,
                )
            }

            if ('symbol' in token && token.symbol !== value) {
                throw this.positionedError(
                    `Unexpected punctuation ${token.symbol}, expected: ${value}`,
                    token,
                )
            }

            if ('operator' in token && !value.includes(token.operator)) {
                throw this.positionedError(
                    `Unexpected operator ${token.operator}, expected one of: ${value}`,
                    token,
                )
            }
        }

        return token
    }

    peek(options?: { skippingNewline: true }): Token | undefined {
        const clone = this.clone()
        return clone.next(options)
    }

    next(options?: { skippingNewline: true } | undefined): Token | undefined {
        this.skipIgnoredCharacters(options?.skippingNewline ?? false)
        if (!this.source.hasMoreCharacters()) return

        if (this.source.peek(1) == '"') return this.consumeStringLiteral()
        if (this.source.peek(1) == '/' && this.isRegexPosition())
            return this.consumeRegexLiteral()
        if (this.source.peek(1) == '\n') return this.collapsedNewlineToken()

        if (punctuationChars.has(this.source.peek(1)))
            return this.readPunctuation()

        const loc = { ...this.source.location }
        const next = this.source.peekUntil(/[^\w.]/)
        if (next.includes('.') && !isValidDecimal(next)) {
            const length = next.indexOf('.')
            this.source.skip(length)
            const token = asToken(next.substring(0, length), loc)
            if (token && token.kind != 'NEWLINE') this.previousToken = token
            return token
        } else {
            this.source.skip(next.length)
            const token = asToken(next, loc)
            if (token && token.kind != 'NEWLINE') this.previousToken = token
            return token
        }
    }

    private isRegexPosition(): boolean {
        const prev = this.previousToken
        if (!prev) return true // start of file

        switch (prev.kind) {
            case 'OPERATOR':
                return true
            case 'PUNCTUATION':
                return ['(', '[', '{', ','].includes(prev.symbol)
            default:
                return false
        }
    }

    private skipIgnoredCharacters(includingNewline: boolean) {
        this.source.skipMatching(includingNewline ? /[^\S]/ : /[^\S\n]/)

        if (this.source.peek(2) == '//') {
            this.source.skipThrough('\n')
            this.skipIgnoredCharacters(includingNewline)
        }
        if (this.source.peek(2) == '/*') {
            this.source.skip(2)
            this.source.skipThrough('*/')
            this.skipIgnoredCharacters(includingNewline)
        }
    }

    private consumeStringLiteral(): StringLiteralToken {
        const m = this.source.peekMatch(/"((?:\\.|[^"\\])*)"/)
        const value =
            m?.[1] ?? this.source.source.substring(this.source.location.index)
        const { line, column } = { ...this.source.location }

        this.source.skip(value.length + 2)
        return {
            kind: 'STRING_LITERAL',
            value,
            line,
            column,
        }
    }

    private consumeRegexLiteral(): RegexLiteralToken {
        const m = this.source.peekMatch(/\/((?:\\.|\[.*\]|[^/\\])+)\/([gmi]*)/)
        const pattern =
            m?.[1] ?? this.source.source.substring(this.source.location.index)
        const modifiers = m?.[2]
        const { line, column } = { ...this.source.location }

        this.source.skip(pattern.length + 2)
        if (modifiers) this.source.skip(modifiers.length)
        return {
            kind: 'REGEX_LITERAL',
            pattern,
            modifiers: modifiers ? new Set(modifiers) : undefined,
            line,
            column,
        }
    }

    private collapsedNewlineToken(): NewlineToken {
        const { line, column } = this.source.location
        const token: Token = {
            kind: 'NEWLINE',
            line,
            column,
        }
        this.source.skipMatching(/\s/)
        return token
    }

    private readPunctuation(): Token | undefined {
        const { line, column } = this.source.location
        const symbol = this.source.peekUntil(/[\s\w"]/)

        const best = [...punctuationSymbols, ...operators]
            .filter((p) => symbol.startsWith(p))
            .reduce(
                (acc, current) => (acc.length < current.length ? current : acc),
                symbol[0],
            )

        if (operators.has(best)) {
            this.source.skip(best.length)
            return {
                kind: 'OPERATOR',
                operator: best as Operator,
                line,
                column,
            }
        } else {
            this.source.skip(best.length)
            return {
                kind: 'PUNCTUATION',
                symbol: best as PunctuationSymbol,
                line,
                column,
            }
        }
    }

    private positionedError(message: string, token: Token) {
        return positionedError(message, {
            file: this.file,
            line: token.line,
            column: token.column,
        })
    }
}

class Source {
    location: SourceLocation
    source: string

    constructor(source: string) {
        this.source = source
        this.location = {
            index: 0,
            line: 1,
            column: 1,
        }
    }

    clone(): Source {
        const clone = new Source(this.source)
        clone.location = { ...this.location }
        return clone
    }

    peek(count: number): string {
        return this.source.substring(
            this.location.index,
            this.location.index + count,
        )
    }

    peekMatch(regex: RegExp): string[] | null {
        return new BetterRegex(regex).exec(this.source, this.location.index)
    }

    peekUntil(regex: RegExp): string {
        const loc = this.location
        const endIndex =
            new BetterRegex(regex).exec(this.source, loc.index)?.index ??
            this.source.length
        return this.peek(endIndex - loc.index)
    }

    skipMatching(match: RegExp) {
        while (
            this.hasMoreCharacters() &&
            match.test(this.source[this.location.index])
        ) {
            this.skip(1)
        }
    }
    skipThrough(endMarker: string) {
        const endMarkerIndex = this.source.indexOf(
            endMarker,
            this.location.index,
        )
        while (this.location.index < endMarkerIndex) this.skip(1)
        this.skip(endMarker.length)
    }

    skip(steps: number) {
        if (steps <= 0) return

        const target = this.location.index + steps

        while (this.location.index < target) {
            if (this.source[this.location.index] == '\n') {
                this.location.line++
                this.location.column = 1
            } else {
                this.location.column++
            }
            this.location.index++
        }
    }

    hasMoreCharacters() {
        return this.location.index < this.source.length
    }
}

function isValidDecimal(next: string) {
    try {
        Decimal(next.replaceAll('_', ''))
        return true
    } catch {
        return false
    }
}

type SourceLocation = {
    line: number
    column: number
    index: number
}

class BetterRegex {
    wrapped: RegExp

    constructor(wrapped: RegExp) {
        this.wrapped = wrapped
    }

    exec(source: string, index: number) {
        const re = new RegExp(this.wrapped, 'g')
        re.lastIndex = index
        return re.exec(source)
    }
}

function asToken(next: string, loc: SourceLocation): Token | undefined {
    if (!next) return

    const { line, column } = loc
    if (keywords.has(next)) {
        return {
            kind: 'KEYWORD',
            keyword: next as Keyword,
            line,
            column,
        }
    }
    if (truthValues.has(next)) {
        return {
            kind: 'TRUTH_LITERAL',
            value: next as TruthLiteral,
            line,
            column,
        }
    }

    // Treat standalone or underscore-only sequences as identifiers, not numbers.
    if (/^_+$/.test(next)) {
        return {
            kind: 'IDENTIFIER',
            identifier: next,
            line,
            column,
        }
    }

    try {
        return {
            kind: 'INTEGER_LITERAL',
            value: BigInt(next.replaceAll('_', '')),
            line,
            column,
        }
    } catch {}
    try {
        const real = Decimal(next)
        return {
            kind: 'REAL_LITERAL',
            value: real,
            line,
            column,
        }
    } catch {}
    return {
        kind: 'IDENTIFIER',
        identifier: next,
        line,
        column,
    }
}
