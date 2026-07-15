import {
  type PipelineExecutionPlan,
  type PipelineExecutionPlanConfig,
  createExecutionPlan,
  readExecutionPlanDocument,
  readLastUsedExecutionPlanId,
  saveExecutionPlan,
  writeLastUsedExecutionPlanId,
} from '@/features/pipeline/pipeline-execution-plans'
import { create } from 'zustand'

type ExecutionPlanState = {
  plans: PipelineExecutionPlan[]
  selectedPlanId: string | null
  savePlan: (
    name: string,
    config: PipelineExecutionPlanConfig,
  ) => { ok: true; plan: PipelineExecutionPlan } | { ok: false; reason: 'limit' }
  selectPlan: (planId: string) => void
}

function initialState() {
  const plans = readExecutionPlanDocument(window.localStorage)?.plans ?? []
  return {
    plans,
    selectedPlanId: readLastUsedExecutionPlanId(window.localStorage, plans),
  }
}

export const useExecutionPlanStore = create<ExecutionPlanState>((set) => ({
  ...initialState(),
  savePlan: (name, config) => {
    const plan = createExecutionPlan(name, config)
    const saved = saveExecutionPlan(window.localStorage, plan)
    if (!saved.ok) {
      return saved
    }
    writeLastUsedExecutionPlanId(window.localStorage, plan.id)
    set({ plans: saved.document.plans, selectedPlanId: plan.id })
    return { ok: true, plan }
  },
  selectPlan: (planId) =>
    set((state) => {
      if (!state.plans.some((plan) => plan.id === planId)) {
        return state
      }
      writeLastUsedExecutionPlanId(window.localStorage, planId)
      return { selectedPlanId: planId }
    }),
}))
