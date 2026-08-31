type AiModelIconKind = 'vision' | 'tools' | 'reasoning' | 'test'

interface AiModelIconProps {
  kind: AiModelIconKind
  className?: string
}

export default function AiModelIcon({ kind, className = 'h-3 w-3' }: AiModelIconProps) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (kind === 'vision') {
    return <svg {...common}><path d="M2.06 12.35a1 1 0 0 1 0-.7 10 10 0 0 1 19.88 0 1 1 0 0 1 0 .7 10 10 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></svg>
  }

  if (kind === 'tools') {
    return <svg {...common}><path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9" /><path d="m14 7 3-3 3 3-3 3" /><path d="m18 3 3 3" /><path d="m3 21 6-6" /></svg>
  }

  if (kind === 'reasoning') {
    return <svg {...common} viewBox="5 5 90 90" strokeWidth="8"><g transform="rotate(45 50 50)"><ellipse cx="50" cy="50" rx="44" ry="18" /></g><g transform="rotate(-45 50 50)"><ellipse cx="50" cy="50" rx="44" ry="18" /></g></svg>
  }

  return <svg {...common}><path d="M3.2 8.8a4.7 4.7 0 0 1 8.8-2.4 4.7 4.7 0 0 1 8.8 2.4c0 5.1-4.3 8.3-8.8 11.2C7.5 17.1 3.2 13.9 3.2 8.8Z" /><path d="M3 12h4l1.5-3 3 6 1.5-3H21" /></svg>
}
