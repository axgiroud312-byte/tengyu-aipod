import type { PipelineProgress, PipelineRunConfig } from '@tengyu-aipod/shared'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'
import type { PipelineConfigStage } from '../types'
import { PipelineRail } from './PipelineRail'
import { PipelineItemsPanel, PipelineLogDialog, PipelineResultsPanel } from './PipelineResultPanels'

export function RunTheater({
  config,
  isLogOpen,
  message,
  onLogOpenChange,
  onSelectStage,
  progress,
  railView,
  selectedStage,
}: {
  config: PipelineRunConfig
  isLogOpen: boolean
  message: string
  onLogOpenChange: (open: boolean) => void
  onSelectStage: (stage: PipelineConfigStage) => void
  progress: PipelineProgress | null
  railView: PipelineRailViewModel
  selectedStage: PipelineConfigStage | null
}) {
  return (
    <div className="space-y-5">
      <PipelineRail onSelectStage={onSelectStage} selectedStage={selectedStage} view={railView} />
      <PipelineResultsPanel config={config} message={message} progress={progress} />
      <PipelineItemsPanel progress={progress} />
      <PipelineLogDialog
        logs={progress?.logs ?? []}
        onOpenChange={onLogOpenChange}
        open={isLogOpen}
      />
    </div>
  )
}
