import {
  type PipelineExecutionPlan,
  type PipelineExecutionPlanApplication,
  type PipelineExecutionPlanConfig,
  type PipelineExecutionPlanSessionValues,
  applyExecutionPlanConfig,
  createExecutionPlan,
  readExecutionPlanDocument,
  readLastUsedExecutionPlanId,
  saveExecutionPlan,
  writeLastUsedExecutionPlanId,
} from '@/features/pipeline/pipeline-execution-plans'
import type { PipelineSourceDraftMap } from '@/features/pipeline/pipeline-source-drafts'
import { create } from 'zustand'

type ExecutionPlanState = {
  plans: PipelineExecutionPlan[]
  selectedPlanId: string | null
  activePlanId: string | null
  application: { revision: number; sessionValues: PipelineExecutionPlanSessionValues } | null
  savePlan: (
    name: string,
    config: PipelineExecutionPlanConfig,
  ) => { ok: true; plan: PipelineExecutionPlan } | { ok: false; reason: 'limit' }
  selectPlan: (planId: string) => void
  applyPlan: (
    plan: PipelineExecutionPlan,
    sourceDrafts: PipelineSourceDraftMap,
  ) => PipelineExecutionPlanApplication
}

function initialState() {
  const plans = readExecutionPlanDocument(window.localStorage)?.plans ?? []
  const activePlanId = readLastUsedExecutionPlanId(window.localStorage, plans)
  return {
    plans,
    selectedPlanId: activePlanId,
    activePlanId,
    application: null,
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
    set({ plans: saved.document.plans, selectedPlanId: plan.id })
    return { ok: true, plan }
  },
  selectPlan: (planId) =>
    set((state) => {
      if (!state.plans.some((plan) => plan.id === planId)) {
        return state
      }
      return { selectedPlanId: planId }
    }),
  applyPlan: (plan, sourceDrafts) => {
    const application = applyExecutionPlanConfig(plan.config, sourceDrafts)
    writeLastUsedExecutionPlanId(window.localStorage, plan.id)
    set((state) => ({
      activePlanId: plan.id,
      selectedPlanId: plan.id,
      application: {
        revision: (state.application?.revision ?? 0) + 1,
        sessionValues: application.sessionValues,
      },
    }))
    return application
  },
}))
