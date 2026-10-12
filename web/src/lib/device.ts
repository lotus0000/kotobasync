export function defaultDeviceName(userAgent: string): string {
  const kind = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Macintosh/.test(userAgent)
            ? 'Mac'
            : '浏览器'
  return `${kind} PWA`
}
