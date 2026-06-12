export interface RawCommentUiConfig {
  apiOrigin?: string;
  allowedParentOrigins?: string[] | string;
  sourceRepoUrl?: string;
  storageNamespace?: string;
  nicknameStorageKey?: string;
  title?: string;
  anonymousNickname?: string;
}

export interface CommentUiConfig {
  apiOrigin: string;
  allowedParentOrigins: Set<string>;
  sourceRepoUrl: string;
  nicknameStorageKey: string;
  commentedImagesStorageKey: string;
  title: string;
  anonymousNickname: string;
}

declare global {
  interface Window {
    COMMENT_UI_CONFIG?: RawCommentUiConfig;
  }
}

const DEFAULT_STORAGE_NAMESPACE = 'comment_ui';
const DEFAULT_SOURCE_REPO_URL = 'https://github.com/Tchirek/comment-ui';

const PRESETS: Record<string, RawCommentUiConfig & { storageNamespace?: string }> = {
  normalpics: {
    apiOrigin: 'https://api.pics.tchirek.top',
    allowedParentOrigins: ['https://sicnu.pics.tchirek.top'],
    storageNamespace: 'normalpics_comment_ui',
    title: '评论'
  },
  normaldocs: {
    apiOrigin: 'https://api.docs.tchirek.top',
    allowedParentOrigins: ['https://sicnu.docs.tchirek.top'],
    storageNamespace: 'normaldocs_comment_ui',
    title: '评论'
  }
};

function env(): Record<string, string | undefined> {
  return ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {});
}

function splitList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeApiOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '');
  return trimmed.replace(/\/+$/, '');
}

function readOrigins(raw: RawCommentUiConfig, runtimeEnv: Record<string, string | undefined>): Set<string> {
  const configured = splitList(raw.allowedParentOrigins);
  const fromEnv = splitList(runtimeEnv.VITE_ALLOWED_PARENT_ORIGINS);
  const origins = configured.length > 0 ? configured : fromEnv;
  return new Set(origins.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin)));
}

export function readConfig(): CommentUiConfig {
  const runtimeEnv = env();
  const presetName = new URLSearchParams(window.location.search).get('preset') || '';
  const preset = PRESETS[presetName] || {};
  const raw = { ...preset, ...(window.COMMENT_UI_CONFIG ?? {}) };
  const storageNamespace = raw.storageNamespace || runtimeEnv.VITE_STORAGE_NAMESPACE || DEFAULT_STORAGE_NAMESPACE;

  return {
    apiOrigin: normalizeApiOrigin(raw.apiOrigin || runtimeEnv.VITE_COMMENT_API_ORIGIN || ''),
    allowedParentOrigins: readOrigins(raw, runtimeEnv),
    sourceRepoUrl: raw.sourceRepoUrl || runtimeEnv.VITE_SOURCE_REPO_URL || DEFAULT_SOURCE_REPO_URL,
    nicknameStorageKey: raw.nicknameStorageKey || `${storageNamespace}_nickname`,
    commentedImagesStorageKey: `${storageNamespace}_commented_images`,
    title: raw.title || runtimeEnv.VITE_COMMENT_TITLE || '评论',
    anonymousNickname: raw.anonymousNickname || runtimeEnv.VITE_ANONYMOUS_NICKNAME || 'Anonymous'
  };
}
