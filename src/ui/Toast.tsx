import { useEffect } from 'react'
import { useHa } from '@/ha/store'

export default function Toast() {
  const notice = useHa((s) => s.notice)
  const clear = useHa((s) => s.clearNotice)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clear, 4500)
    return () => clearTimeout(t)
  }, [notice, clear])
  if (!notice) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-50 flex justify-center px-4">
      <p className="glass pointer-events-auto rounded-xl px-4 py-2.5 text-[13px] font-medium" role="status">
        {notice}
      </p>
    </div>
  )
}
