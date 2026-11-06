#!/usr/bin/env node
// This repo is public and Map gets tried on private repos, so nothing from one may land here.
// Scans the lines this branch adds, committed or staged, and exits 1 on a hit. The words are
// stored encoded so this file does not trip its own scan.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const words = (b64) => Buffer.from(b64, 'base64').toString()
const ANY_CASE = new RegExp(words('cGFycm90fGphcnZpc3xrMzF6fGhlYXJkLWJ1aWxkc3xoZWFyZC12M3xIZWFyZEZhY2V8aGVhcmRsYWJz'), 'i')
const WHOLE_WORD = new RegExp(`\\b${words('SGVhcmQ=')}\\b`) // case matters: the ordinary verb is fine

export const hits = (diff) => diff.split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .filter((line) => ANY_CASE.test(line) || WHOLE_WORD.test(line))

export function scan(cwd = process.cwd()) {
  const diff = (...args) => execFileSync('git', ['diff', '--unified=0', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  // A pull request's CI checkout has no local main, only the remote one.
  const base = ['main', 'origin/main'].find((ref) => { try { execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, stdio: 'ignore' }); return true } catch { return false } })
  if (!base) throw new Error('leak scan needs main or origin/main to compare against')
  return hits(diff(`${base}..HEAD`) + diff('--cached'))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = scan()
  for (const line of found) console.error(line.slice(0, 160))
  console.log(found.length ? `${found.length} leak scan hit(s)` : 'leak scan clean')
  process.exit(found.length ? 1 : 0)
}
