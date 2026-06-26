import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'

export type WorkbenchPathDomain =
  | 'collection'
  | 'generation'
  | 'detection'
  | 'listing'
  | 'local-image'
  | 'visible-workbench'

type WorkbenchPathGuardOptions = {
  domain: WorkbenchPathDomain
  label?: string
}

const PIPELINE_RUNS_FOLDER = 'pipeline-runs'

export async function assertPathInsideWorkbench(
  workbenchRoot: string,
  targetPath: string,
  options: WorkbenchPathGuardOptions,
) {
  const parsedRoot = workbenchRoot.trim()
  const parsedTarget = targetPath.trim()
  if (!parsedRoot || !parsedTarget) {
    throw new AppErrorClass('HTTP_4XX', `${options.label ?? '路径'}不能为空`, false, {
      kind: 'validation',
    })
  }

  const allowedRoots = workbenchDomainRoots(parsedRoot, options.domain)
  const canonicalTarget = await canonicalPath(parsedTarget)
  const canonicalRoots = await Promise.all(allowedRoots.map((root) => canonicalPath(root)))
  if (canonicalRoots.some((root) => sameOrInside(canonicalTarget, root))) {
    return canonicalTarget
  }

  throw new AppErrorClass('HTTP_4XX', `${options.label ?? '路径'}必须位于工作区允许目录内`, false, {
    kind: 'path_outside_workbench',
    domain: options.domain,
    targetPath: parsedTarget,
    allowedRoots,
  })
}

export async function isPathInsideWorkbench(
  workbenchRoot: string,
  targetPath: string,
  domain: WorkbenchPathDomain,
) {
  try {
    await assertPathInsideWorkbench(workbenchRoot, targetPath, { domain })
    return true
  } catch {
    return false
  }
}

export function workbenchDomainRoots(workbenchRoot: string, domain: WorkbenchPathDomain) {
  const root = resolve(workbenchRoot)
  const businessRoots = [
    join(root, WORKBENCH_DIRECTORIES.collection),
    join(root, WORKBENCH_DIRECTORIES.generation),
    join(root, WORKBENCH_DIRECTORIES.detection),
    join(root, WORKBENCH_DIRECTORIES.listing),
  ]
  const privateImageRoots = [
    join(root, WORKBENCH_DIRECTORIES.metadata, 'tmp'),
    join(root, WORKBENCH_DIRECTORIES.metadata, PIPELINE_RUNS_FOLDER),
  ]

  switch (domain) {
    case 'collection':
      return [join(root, WORKBENCH_DIRECTORIES.collection)]
    case 'generation':
      return [join(root, WORKBENCH_DIRECTORIES.generation)]
    case 'detection':
      return [join(root, WORKBENCH_DIRECTORIES.detection)]
    case 'listing':
      return [join(root, WORKBENCH_DIRECTORIES.listing)]
    case 'local-image':
      return [...businessRoots, ...privateImageRoots]
    case 'visible-workbench':
      return [...businessRoots, ...privateImageRoots]
  }
}

export async function canonicalPath(path: string): Promise<string> {
  const resolved = resolve(path)
  const tail: string[] = []
  let current = resolved

  while (true) {
    try {
      const existing = await realpath(current)
      return tail.reduce((value, part) => join(value, part), existing)
    } catch {
      const parent = dirname(current)
      if (parent === current) {
        return resolved
      }
      tail.unshift(basename(current))
      current = parent
    }
  }
}

function sameOrInside(child: string, parent: string) {
  if (child === parent) {
    return true
  }
  const value = relative(parent, child)
  return Boolean(value) && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}
