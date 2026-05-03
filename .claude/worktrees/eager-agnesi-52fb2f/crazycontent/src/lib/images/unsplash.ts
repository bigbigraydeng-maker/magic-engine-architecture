/**
 * Unsplash API Integration
 * Fetches high-quality images for content generation
 */

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const UNSPLASH_API = 'https://api.unsplash.com';

export interface UnsplashImage {
  id: string;
  url: string;           // Regular size (1080px)
  thumb: string;         // Thumbnail (200px)
  downloadUrl: string;   // Full resolution download
  alt: string;
  photographer: string;
  photographerUrl: string;
  width: number;
  height: number;
}

/**
 * Search Unsplash for images matching a query
 */
export async function searchImages(
  query: string,
  options?: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'squarish' }
): Promise<UnsplashImage[]> {
  if (!UNSPLASH_ACCESS_KEY) {
    console.warn('[Unsplash] No API key configured (UNSPLASH_ACCESS_KEY)');
    return [];
  }

  const params = new URLSearchParams({
    query,
    per_page: String(options?.perPage || 5),
    content_filter: 'high',
  });

  if (options?.orientation) {
    params.set('orientation', options.orientation);
  }

  try {
    const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });

    if (!res.ok) {
      console.error(`[Unsplash] API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    return (data.results || []).map((photo: any) => ({
      id: photo.id,
      url: photo.urls.regular,
      thumb: photo.urls.thumb,
      downloadUrl: photo.links.download_location,
      alt: photo.alt_description || photo.description || query,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      width: photo.width,
      height: photo.height,
    }));
  } catch (error) {
    console.error('[Unsplash] Fetch error:', error);
    return [];
  }
}

/**
 * Trigger Unsplash download tracking (required by API guidelines)
 */
export async function trackDownload(downloadUrl: string): Promise<void> {
  if (!UNSPLASH_ACCESS_KEY) return;

  try {
    await fetch(`${downloadUrl}?client_id=${UNSPLASH_ACCESS_KEY}`);
  } catch {
    // Non-critical, don't throw
  }
}

/**
 * Search images using AI-generated queries for better relevance
 */
export async function searchImagesForTopic(
  topic: string,
  keywords: string[],
  platform: 'facebook' | 'xiaohongshu'
): Promise<UnsplashImage[]> {
  // Build a smart search query from topic + keywords
  const searchQuery = `${topic} ${keywords.slice(0, 2).join(' ')}`;
  const orientation = platform === 'xiaohongshu' ? 'portrait' : 'landscape';

  return searchImages(searchQuery, { perPage: 6, orientation });
}
