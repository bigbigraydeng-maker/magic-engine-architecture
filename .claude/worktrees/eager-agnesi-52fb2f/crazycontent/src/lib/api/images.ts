/**
 * Client-side API for Unsplash image search and selection
 */

export interface UnsplashImageResult {
  id: string;
  url: string;
  thumb: string;
  downloadUrl: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  width: number;
  height: number;
}

/**
 * Search Unsplash images by topic + keywords
 */
export async function searchImages(
  topic: string,
  keywords: string[],
  platform: 'facebook' | 'xiaohongshu'
): Promise<UnsplashImageResult[]> {
  const params = new URLSearchParams({
    topic,
    keywords: keywords.join(','),
    platform,
  });

  const res = await fetch(`/api/crazy-content/images?${params}`);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error?.message || 'Image search failed');
  }

  return json.data || [];
}

/**
 * Search Unsplash images by free-text query
 */
export async function searchImagesByQuery(
  query: string,
  platform: 'facebook' | 'xiaohongshu' = 'facebook'
): Promise<UnsplashImageResult[]> {
  const params = new URLSearchParams({ query, platform });

  const res = await fetch(`/api/crazy-content/images?${params}`);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error?.message || 'Image search failed');
  }

  return json.data || [];
}

/**
 * Save selected image to a task (confirm selection)
 */
export async function saveImageToTask(input: {
  task_id: string;
  project_id: string;
  image_url: string;
  download_url: string;
  photographer: string;
  photographer_url: string;
}): Promise<void> {
  const res = await fetch('/api/crazy-content/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error?.message || 'Failed to save image');
  }
}
