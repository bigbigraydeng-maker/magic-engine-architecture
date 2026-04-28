/**
 * Supabase Storage helpers for brief source file uploads.
 * Bucket: brief-uploads (private, 30MB limit)
 */

import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export const BRIEF_BUCKET = 'brief-uploads'

const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])

export interface UploadedBriefFile {
  storage_path: string     // path inside bucket
  storage_url: string      // full supabase storage URL
  filename: string
  size_bytes: number
  content_type: string
  sha256: string
}

/**
 * Upload a brief source file to Supabase Storage.
 */
export async function uploadBriefFile(params: {
  clientId: string
  file: Buffer
  filename: string
  contentType: string
}): Promise<UploadedBriefFile> {
  const { clientId, file, filename, contentType } = params

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new BriefStorageError(
      `Unsupported file type: ${contentType}. Allowed: PDF, Word, TXT`,
      'INVALID_TYPE'
    )
  }

  // Validate size
  if (file.byteLength > MAX_FILE_SIZE) {
    throw new BriefStorageError(
      `File too large: ${(file.byteLength / 1024 / 1024).toFixed(1)}MB. Max: 30MB`,
      'FILE_TOO_LARGE'
    )
  }

  // Sanitize filename and build storage path
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const timestamp = Date.now()
  const storagePath = `${clientId}/${timestamp}-${safe}`

  // Compute SHA-256 for deduplication
  const sha256 = crypto.createHash('sha256').update(file).digest('hex')

  const { error } = await supabaseAdmin.storage
    .from(BRIEF_BUCKET)
    .upload(storagePath, file, {
      contentType,
      upsert: false,
    })

  if (error) {
    throw new BriefStorageError(`Upload failed: ${error.message}`, 'UPLOAD_FAILED')
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(BRIEF_BUCKET)
    .getPublicUrl(storagePath)

  return {
    storage_path: storagePath,
    storage_url: urlData.publicUrl,
    filename,
    size_bytes: file.byteLength,
    content_type: contentType,
    sha256,
  }
}

/**
 * Generate a short-lived signed URL for Claude to download a file.
 * Claude needs to fetch the file content to process it.
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BRIEF_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error || !data?.signedUrl) {
    throw new BriefStorageError(`Failed to create signed URL: ${error?.message}`, 'SIGNED_URL_FAILED')
  }

  return data.signedUrl
}

/**
 * Download a file from Supabase Storage as a Buffer.
 * Used by the pipeline to get file content for Claude.
 */
export async function downloadBriefFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage
    .from(BRIEF_BUCKET)
    .download(storagePath)

  if (error || !data) {
    throw new BriefStorageError(`Download failed: ${error?.message}`, 'DOWNLOAD_FAILED')
  }

  return Buffer.from(await data.arrayBuffer())
}

/**
 * Delete a brief file from storage (used in cleanup).
 */
export async function deleteBriefFile(storagePath: string): Promise<void> {
  await supabaseAdmin.storage
    .from(BRIEF_BUCKET)
    .remove([storagePath])
}

export class BriefStorageError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_TYPE' | 'FILE_TOO_LARGE' | 'UPLOAD_FAILED' | 'SIGNED_URL_FAILED' | 'DOWNLOAD_FAILED'
  ) {
    super(message)
    this.name = 'BriefStorageError'
  }
}
