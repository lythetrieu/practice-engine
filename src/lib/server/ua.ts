// Coarse browser details from the User-Agent header, for the practice app's error and problem reports.
// Only the family, major version and system are kept, never the full header.

/** "Safari 18 · iOS", "Chrome 141 · Android", "Firefox 132 · Windows": the family, major version and system only. */
export function browserOf(ua: string): string | null {
  const m = (re: RegExp) => ua.match(re)?.[1];
  const v =
    (m(/SamsungBrowser\/(\d+)/) && `Samsung Internet ${m(/SamsungBrowser\/(\d+)/)}`) ||
    (m(/Edg(?:A|iOS)?\/(\d+)/) && `Edge ${m(/Edg(?:A|iOS)?\/(\d+)/)}`) ||
    (m(/(?:Firefox|FxiOS)\/(\d+)/) && `Firefox ${m(/(?:Firefox|FxiOS)\/(\d+)/)}`) ||
    (m(/(?:Chrome|CriOS)\/(\d+)/) && `Chrome ${m(/(?:Chrome|CriOS)\/(\d+)/)}`) ||
    (/Safari\//.test(ua) && m(/Version\/(\d+)/) && `Safari ${m(/Version\/(\d+)/)}`) ||
    null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : null;
  return v ? (os ? `${v} · ${os}` : v) : os;
}
