import startHereMarkdown from './content/00-start-here.md?raw'
import collectionTemuMarkdown from './content/collection/temu.md?raw'
import generationCommonPathsMarkdown from './content/generation/common-paths.md?raw'
import photoshopBatchMockupMarkdown from './content/photoshop/batch-mockup.md?raw'

export type TutorialChapterId =
  | 'start-here'
  | 'collection-temu'
  | 'generation-common-paths'
  | 'photoshop-batch-mockup'

export type TutorialChapter = {
  id: TutorialChapterId
  title: string
  description: string
  markdown: string
}

export const tutorialChapters: TutorialChapter[] = [
  {
    id: 'start-here',
    title: '开始前准备',
    description: '工作区、API Key、日志和输出目录',
    markdown: startHereMarkdown,
  },
  {
    id: 'collection-temu',
    title: 'Temu 采集',
    description: '扫描图池、下载图片和查看保存位置',
    markdown: collectionTemuMarkdown,
  },
  {
    id: 'generation-common-paths',
    title: '生图常用三项',
    description: '文生图、图生图和提取',
    markdown: generationCommonPathsMarkdown,
  },
  {
    id: 'photoshop-batch-mockup',
    title: 'PS 套版',
    description: 'Windows 前置、模板扫描和批量输出',
    markdown: photoshopBatchMockupMarkdown,
  },
]
