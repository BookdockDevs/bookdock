export interface ReaderSpineSection {
  id: string
  linear?: string
}

export function* forwardTextPaths(sections: ReaderSpineSection[], currentIndex: number): Generator<string> {
  const seen = new Set<string>()
  for (let index = currentIndex + 1; index < sections.length; index += 1) {
    const section = sections[index]
    const path = section?.id.split('#', 1)[0]
    if (!section || section.linear === 'no' || !path || seen.has(path)) continue
    seen.add(path)
    yield path
  }
}
