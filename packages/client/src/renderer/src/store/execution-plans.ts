import {
  EXECUTION_PLAN_STORAGE_KEY,
  LAST_USED_EXECUTION_PLAN_STORAGE_KEY,
  type PipelineExecutionPlan,
  type PipelineExecutionPlanApplication,
  type PipelineExecutionPlanConfig,
  type PipelineExecutionPlanSessionValues,
  applyExecutionPlanConfig,
  createExecutionPlan,
  deleteExecutionPlan,
  overwriteExecutionPlan,
  readExecutionPlanDocument,
  readLastUsedExecutionPlanId,
  renameExecutionPlan,
  saveExecutionPlan,
  writeLastUsedExecutionPlanId,
} from '@/features/pipeline/pipeline-execution-plans'
import type { PipelineSourceDraftMap } from '@/features/pipeline/pipeline-source-drafts'
import { create } from 'zustand'

type ExecutionPlanState = {
  plans: PipelineExecutionPlan[]
  selectedPlanId: string | null
  activePlanId: string | null
  storageError: string | null
  application: { revision: number; sessionValues: PipelineExecutionPlanSessionValues } | null
  savePlan: (
    name: string,
    config: PipelineExecutionPlanConfig,
  ) =>
    | { ok: true; plan: PipelineExecutionPlan }
    | { ok: false; reason: 'limit' | 'invalid-storage'; message?: string }
  overwritePlan: (
    planId: string,
    config: PipelineExecutionPlanConfig,
  ) => { ok: true } | { ok: false; reason: 'not-found' | 'invalid-storage'; message?: string }
  renamePlan: (
    planId: string,
    name: string,
  ) => { ok: true } | { ok: false; reason: 'not-found' | 'invalid-storage'; message?: string }
  deletePlan: (
    planId: string,
  ) => { ok: true } | { ok: false; reason: 'not-found' | 'invalid-storage'; message?: string }
  clearInvalidStorage: () => void
  selectPlan: (planId: string) => void
  applyPlan: (
    plan: PipelineExecutionPlan,
    sourceDrafts: PipelineSourceDraftMap,
  ) => PipelineExecutionPlanApplication
}

function initialState() {
  const result = readExecutionPlanDocument(window.localStorage)
  const plans = result.ok ? result.document.plans : []
  const activePlanId = readLastUsedExecutionPlanId(window.localStorage, plans)
  return {
    plans,
    selectedPlanId: activePlanId,
    activePlanId,
    storageError: result.ok ? null : result.error.message,
    application: null,
  }
}

export const useExecutionPlanStore = create<ExecutionPlanState>((set) => ({
  ...initialState(),
  savePlan: (name, config) => {
    const plan = createExecutionPlan(name, config)
    const saved = saveExecutionPlan(window.localStorage, plan)
    if (!saved.ok) {
      if (saved.reason === 'invalid-storage') {
        set({ storageError: saved.message ?? '执行方案数据无效' })
      }
      return saved
    }
    set({ plans: saved.document.plans, selectedPlanId: plan.id, storageError: null })
    return { ok: true, plan }
  },
  overwritePlan: (planId, config) => {
    const result = overwriteExecutionPlan(window.localStorage, planId, config)
    if (!result.ok) {
      if (result.reason === 'invalid-storage') {
        set({ storageError: result.message ?? '执行方案数据无效' })
      }
      return result
    }
    set({ plans: result.document.plans, storageError: null })
    return { ok: true }
  },
  renamePlan: (planId, name) => {
    const result = renameExecutionPlan(window.localStorage, planId, name)
    if (!result.ok) {
      if (result.reason === 'invalid-storage') {
        set({ storageError: result.message ?? '执行方案数据无效' })
      }
      return result
    }
    set({ plans: result.document.plans, storageError: null })
    return { ok: true }
  },
  deletePlan: (planId) => {
    const result = deleteExecutionPlan(window.localStorage, planId)
    if (!result.ok) {
      if (result.reason === 'invalid-storage') {
        set({ storageError: result.message ?? '执行方案数据无效' })
      }
      return result
    }
    set((state) => {
      const deletedActivePlan = state.activePlanId === planId
      if (deletedActivePlan) {
        window.localStorage.removeItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY)
      }
      return {
        plans: result.document.plans,
        selectedPlanId:
          state.selectedPlanId === planId
            ? deletedActivePlan
              ? null
              : state.activePlanId
            : state.selectedPlanId,
        activePlanId: deletedActivePlan ? null : state.activePlanId,
        storageError: null,
      }
    })
    return { ok: true }
  },
  clearInvalidStorage: () => {
    window.localStorage.removeItem(EXECUTION_PLAN_STORAGE_KEY)
    window.localStorage.removeItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY)
    set({
      plans: [],
      selectedPlanId: null,
      activePlanId: null,
      storageError: null,
      application: null,
    })
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
