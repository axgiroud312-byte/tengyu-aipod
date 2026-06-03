import { cn } from '@/lib/utils'
import { BookOpen, Download, Layers, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type TutorialChapter, type TutorialChapterId, tutorialChapters } from './tutorial-content'

const chapterIconMap = {
  'start-here': Wrench,
  'collection-temu': Download,
  'generation-common-paths': Sparkles,
  'photoshop-batch-mockup': Layers,
} satisfies Record<TutorialChapterId, typeof BookOpen>

const markdownComponents = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold tracking-normal text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 border-b pb-2 text-lg font-semibold tracking-normal text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base font-semibold tracking-normal text-foreground">{children}</h3>
  ),
  p: ({ children }) => <p className="text-sm leading-7 text-muted-foreground">{children}</p>,
  ol: ({ children }) => (
    <ol className="ml-5 list-decimal space-y-2 text-sm leading-7 text-muted-foreground">
      {children}
    </ol>
  ),
  ul: ({ children }) => (
    <ul className="ml-5 list-disc space-y-2 text-sm leading-7 text-muted-foreground">{children}</ul>
  ),
  li: ({ children }) => <li>{children}</li>,
  table: ({ children }) => (
    <div className="my-4 overflow-hidden rounded-md border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/70 text-left text-foreground">{children}</thead>
  ),
  th: ({ children }) => <th className="border-b px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t px-3 py-2 text-muted-foreground">{children}</td>,
  code: ({ children }) => (
    <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
      {children}
    </pre>
  ),
  img: ({ alt, src }) => (
    <figure className="my-5">
      <img
        alt={alt ?? ''}
        className="max-h-[420px] w-full rounded-md border object-contain"
        src={tutorialAssetSrc(src)}
      />
      {alt ? <figcaption className="mt-2 text-xs text-muted-foreground">{alt}</figcaption> : null}
    </figure>
  ),
  a: ({ children, href }) => {
    const external = href?.startsWith('http://') || href?.startsWith('https://')
    return (
      <a
        className="font-medium text-primary underline underline-offset-4"
        href={href}
        rel={external ? 'noreferrer' : undefined}
        target={external ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  },
} satisfies Components

function tutorialAssetSrc(src: string | undefined) {
  return src?.startsWith('/tutorial/') ? `.${src}` : (src ?? '')
}

function chapterById(id: TutorialChapterId): TutorialChapter {
  const fallbackChapter = tutorialChapters[0]
  if (!fallbackChapter) {
    throw new Error('Tutorial page requires at least one chapter')
  }
  return tutorialChapters.find((chapter) => chapter.id === id) ?? fallbackChapter
}

export function TutorialPage() {
  const [activeChapterId, setActiveChapterId] = useState<TutorialChapterId>('start-here')
  const activeChapter = chapterById(activeChapterId)

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-0 xl:max-h-[calc(100vh-8rem)] xl:overflow-auto">
        <div className="rounded-md border bg-background">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-primary" />
              教程目录
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              按生产顺序阅读，也可以直接跳到当前模块。
            </p>
          </div>
          <nav className="space-y-1 p-2">
            {tutorialChapters.map((chapter) => {
              const Icon = chapterIconMap[chapter.id]
              const active = chapter.id === activeChapterId
              return (
                <button
                  className={cn(
                    'flex w-full items-start gap-3 rounded-sm px-3 py-3 text-left transition-colors duration-100',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                  key={chapter.id}
                  onClick={() => setActiveChapterId(chapter.id)}
                  type="button"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{chapter.title}</span>
                    <span
                      className={cn(
                        'mt-1 block text-xs leading-5',
                        active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                      )}
                    >
                      {chapter.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        </div>
      </aside>

      <article className="min-w-0 rounded-md border bg-background">
        <div className="border-b px-6 py-4">
          <p className="text-xs font-medium text-muted-foreground">操作手册</p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal text-foreground">
            {activeChapter.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{activeChapter.description}</p>
        </div>
        <div className="prose-none space-y-4 px-6 py-5">
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {activeChapter.markdown}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  )
}
