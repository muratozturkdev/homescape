import { create } from 'zustand'

/** Whether the plan history window is open (ui/PlanHistory.tsx) */
export const usePlanHistory = create<{ open: boolean }>(() => ({ open: false }))
