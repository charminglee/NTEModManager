export const YOUTUBE_EMBED_SOURCES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/'
] as const

export function parseYouTubeEmbedUrl(source: string): URL | null {
  const url = URL.parse(source, 'https://gamebanana.com/')
  if (!url || !YOUTUBE_EMBED_SOURCES.some((prefix) => url.href.startsWith(prefix))) return null
  if (!/^\/embed\/[\w-]{11}$/.test(url.pathname)) return null
  if (url.pathname === '/embed/videoseries' && !url.searchParams.get('list')) return null
  if (url.pathname === '/embed/live_stream' && !url.searchParams.get('channel')) return null
  return url
}

export function getYouTubeWatchUrl(embedUrl: URL): URL {
  const videoId = embedUrl.pathname.slice('/embed/'.length)
  if (videoId === 'live_stream') {
    const channel = encodeURIComponent(embedUrl.searchParams.get('channel') ?? '')
    return new URL(`https://www.youtube.com/channel/${channel}/live`)
  }
  const watchUrl = new URL(videoId === 'videoseries'
    ? 'https://www.youtube.com/playlist'
    : 'https://www.youtube.com/watch')
  if (videoId !== 'videoseries') watchUrl.searchParams.set('v', videoId)
  const list = embedUrl.searchParams.get('list')
  if (list) watchUrl.searchParams.set('list', list)
  const start = embedUrl.searchParams.get('start')
  if (start) watchUrl.searchParams.set('t', start)
  return watchUrl
}
