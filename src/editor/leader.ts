import type { Features } from './types'

export type LeaderAction = 'files' | 'grep' | 'buffers' | 'stage' | 'preview' | 'blame' | 'rename'

export type LeaderNode = {
  key: string
  desc: string
  action?: LeaderAction
  children?: LeaderNode[]
}

export function leaderTree(features: Features): LeaderNode[] {
  const nodes: LeaderNode[] = []
  if (features.telescope) {
    nodes.push({
      key: 'f',
      desc: 'find',
      children: [
        { key: 'f', desc: 'files', action: 'files' },
        { key: 'g', desc: 'live grep', action: 'grep' },
        { key: 'b', desc: 'buffers', action: 'buffers' },
      ],
    })
  }
  if (features.gitsigns) {
    nodes.push({
      key: 'h',
      desc: 'hunk',
      children: [
        { key: 's', desc: 'stage hunk', action: 'stage' },
        { key: 'p', desc: 'preview hunk', action: 'preview' },
        { key: 'b', desc: 'blame line', action: 'blame' },
      ],
    })
  }
  if (features.lsp) {
    nodes.push({
      key: 'r',
      desc: 'refactor',
      children: [{ key: 'n', desc: 'rename', action: 'rename' }],
    })
  }
  return nodes
}

export function leaderRows(features: Features, prefix: string): { key: string; desc: string }[] {
  let nodes = leaderTree(features)
  for (const ch of prefix) {
    const next = nodes.find((node) => node.key === ch)
    nodes = next?.children ?? []
  }
  return nodes.map((node) => ({ key: node.key, desc: node.desc }))
}

export function lookupLeader(
  features: Features,
  prefix: string,
  key: string,
): { type: 'group'; prefix: string } | { type: 'action'; action: LeaderAction } | { type: 'miss' } {
  let nodes = leaderTree(features)
  for (const ch of prefix) {
    const next = nodes.find((node) => node.key === ch)
    if (!next?.children) return { type: 'miss' }
    nodes = next.children
  }
  const hit = nodes.find((node) => node.key === key)
  if (!hit) return { type: 'miss' }
  if (hit.action) return { type: 'action', action: hit.action }
  if (hit.children) return { type: 'group', prefix: prefix + key }
  return { type: 'miss' }
}
