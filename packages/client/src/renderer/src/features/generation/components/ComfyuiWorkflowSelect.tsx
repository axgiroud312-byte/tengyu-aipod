import type { ComfyuiWorkflowSummary } from '../../../../../main/lib/comfyui-workflow-cache'
import { workflowOptionKey } from '../lib/format'

export function ComfyuiWorkflowSelect({
  label = '工作流',
  onChange,
  workflowKey,
  workflows,
}: {
  label?: string
  onChange: (key: string) => void
  workflowKey: string
  workflows: ComfyuiWorkflowSummary[]
}) {
  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      <select
        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onChange={(event) => onChange(event.target.value)}
        value={workflowKey}
      >
        {workflows.map((workflow) => (
          <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
            {workflow.name} · {workflow.version}
          </option>
        ))}
      </select>
    </label>
  )
}
