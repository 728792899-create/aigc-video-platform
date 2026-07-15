export function displayLocalPath(value: unknown): string {
  const input = String(value || '')
  if (!input) return ''
  return input
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '%USERPROFILE%')
}
