let seq = 0
/** Short id, unique within the session: rooms, items, levels. */
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`
