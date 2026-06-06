import type { WorkbenchModule } from './navigation'

export interface ModuleVisual {
  accent: string
  glow: string
  image: string
}

const moduleVisuals: Record<WorkbenchModule, ModuleVisual> = {
  collection: {
    accent: 'hsl(204 94% 50%)',
    glow: 'rgba(14, 165, 233, 0.2)',
    image: 'brand/visuals/module-collection.png',
  },
  pipeline: {
    accent: 'hsl(221 83% 53%)',
    glow: 'rgba(37, 99, 235, 0.22)',
    image: 'brand/visuals/module-pipeline.png',
  },
  generation: {
    accent: 'hsl(216 92% 56%)',
    glow: 'rgba(59, 130, 246, 0.22)',
    image: 'brand/visuals/module-generation.png',
  },
  detection: {
    accent: 'hsl(189 94% 43%)',
    glow: 'rgba(8, 145, 178, 0.2)',
    image: 'brand/visuals/module-detection.png',
  },
  listing: {
    accent: 'hsl(226 80% 54%)',
    glow: 'rgba(79, 70, 229, 0.22)',
    image: 'brand/visuals/module-listing.png',
  },
  ps: {
    accent: 'hsl(199 89% 48%)',
    glow: 'rgba(2, 132, 199, 0.22)',
    image: 'brand/visuals/module-photoshop.png',
  },
  settings: {
    accent: 'hsl(215 72% 46%)',
    glow: 'rgba(30, 64, 175, 0.16)',
    image: 'brand/visuals/module-support.png',
  },
  title: {
    accent: 'hsl(213 94% 54%)',
    glow: 'rgba(37, 99, 235, 0.2)',
    image: 'brand/visuals/module-title.png',
  },
  tutorial: {
    accent: 'hsl(215 72% 46%)',
    glow: 'rgba(30, 64, 175, 0.16)',
    image: 'brand/visuals/module-support.png',
  },
}

export function moduleVisual(module: WorkbenchModule) {
  return moduleVisuals[module]
}
