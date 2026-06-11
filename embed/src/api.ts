import type { CommentUiConfig } from './config';
import type { CommentItem } from './types';

export class ApiError extends Error {
  readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? Number(retryAfterMs) : null;
  }
}

interface ApiContext {
  viewerId: () => string;
  adminToken: () => string;
}

interface CommentPublishPayload {
  imageId: string;
  nickname: string;
  content: string;
  parentId: string | null;
}

function joinUrl(origin: string, path: string): string {
  if (!origin) return path;
  return `${origin}${path}`;
}

async function parseJson<T>(response: Response): Promise<T & { error?: string; retryAfterMs?: number }> {
  const text = await response.text();
  if (!text) return {} as T & { error?: string; retryAfterMs?: number };
  try {
    return JSON.parse(text) as T & { error?: string; retryAfterMs?: number };
  } catch {
    return {} as T & { error?: string; retryAfterMs?: number };
  }
}

export function createCommentApi(config: CommentUiConfig, context: ApiContext) {
  function headers(includeAdmin = false): HeadersInit {
    const result: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Viewer-Id': context.viewerId()
    };
    const adminToken = context.adminToken();
    if (includeAdmin && adminToken) result.Authorization = `Bearer ${adminToken}`;
    return result;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(joinUrl(config.apiOrigin, path), init);
    const body = await parseJson<T>(response);
    if (!response.ok) throw new ApiError(body.error || `request_${response.status}`, body.retryAfterMs);
    return body;
  }

  return {
    list(imageId: string): Promise<{ items: CommentItem[]; commentedByMe?: boolean }> {
      return request<{ items: CommentItem[]; commentedByMe?: boolean }>(
        `/api/comment?imageId=${encodeURIComponent(imageId)}`,
        { headers: headers() }
      );
    },

    publish(payload: CommentPublishPayload): Promise<unknown> {
      return request('/api/comment', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
    },

    setLike(commentId: string, liked: boolean): Promise<{ likedByMe: boolean; likeCount: number }> {
      return request<{ likedByMe: boolean; likeCount: number }>(`/api/comment/${encodeURIComponent(commentId)}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ liked })
      });
    },

    delete(commentId: string): Promise<unknown> {
      return request(`/api/comment/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        headers: headers(true)
      });
    }
  };
}
