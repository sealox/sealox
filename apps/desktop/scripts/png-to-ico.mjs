#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output] = process.argv
if (!input || !output) throw new Error('Usage: node png-to-ico.mjs input.png output.ico')

const png = readFileSync(input)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt8(0, 6)
header.writeUInt8(0, 7)
header.writeUInt8(0, 8)
header.writeUInt8(0, 9)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(png.length, 14)
header.writeUInt32LE(header.length, 18)
writeFileSync(output, Buffer.concat([header, png]))
