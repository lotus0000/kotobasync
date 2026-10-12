const LEVELS = [0, 1, 2, 3, 4, 5]

export function FamiliarityDots({ value }: { value: number }) {
  return (
    <span className="flex shrink-0 gap-1 pt-2" aria-label={`熟悉度 ${value}`}>
      {LEVELS.slice(1).map((n) => (
        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= value ? 'bg-amber-500' : 'bg-stone-300 dark:bg-stone-700'}`} />
      ))}
    </span>
  )
}

export function FamiliarityPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="熟悉度">
      {LEVELS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={`h-9 flex-1 rounded-lg text-sm font-medium ${
            value === n ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'bg-stone-100 dark:bg-stone-800'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
