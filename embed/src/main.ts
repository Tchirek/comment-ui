import './style.css';
import { ApiError, createCommentApi } from './api';
import { readConfig } from './config';
import { commentNickname, renderComments } from './comments';
import { mountApp } from './dom';
import { renderSafeMarkdown } from './markdown';
import { installPanelPull } from './panelPull';
import { createParentBridge } from './parentBridge';
import type { CommentAppState, CommentItem, ParentMessage } from './types';

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('missing_app_root');

const config = readConfig();
const elements = mountApp(appRoot, config);
const bridge = createParentBridge(config);
const api = createCommentApi(config, {
  viewerId: () => state.viewerId,
  adminToken: () => state.adminToken
});
const panelPull = installPanelPull(elements.app, bridge);
const pendingLikes = new Set<string>();

const state: CommentAppState = {
  imageId: '',
  viewerId: '',
  adminToken: '',
  replyTo: null,
  comments: [],
  loadedImageId: '',
  loading: false,
  loadAgain: false,
  loadError: '',
  previewing: false
};

function readCommentedImages(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(config.commentedImagesStorageKey) || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0));
  } catch {
    return new Set();
  }
}

function hasLocalCommentedImage(imageId: string): boolean {
  return readCommentedImages().has(imageId);
}

function markLocalCommentedImage(imageId: string): void {
  const values = readCommentedImages();
  values.add(imageId);
  const compact = Array.from(values).slice(-500);
  localStorage.setItem(config.commentedImagesStorageKey, JSON.stringify(compact));
}

function formatCooldown(value: number | null): string {
  const milliseconds = Math.max(1_000, value || 0);
  const hours = Math.ceil(milliseconds / 3_600_000);
  return hours >= 24 ? `约 ${Math.ceil(hours / 24)} 天后` : `约 ${hours} 小时后`;
}

function setPreview(visible: boolean): void {
  state.previewing = visible;
  elements.preview.hidden = !visible;
  elements.textarea.hidden = visible;
  elements.previewToggle.textContent = visible ? '编辑' : '预览';
  if (visible) elements.preview.innerHTML = renderSafeMarkdown(elements.textarea.value);
}

function setReplyTarget(item: CommentItem | null): void {
  state.replyTo = item;
  elements.replyTarget.hidden = !item;
  if (item) {
    elements.replyTarget.textContent = `回复 ${commentNickname(item.nickname, config.anonymousNickname)} · 点击取消`;
    elements.textarea.focus();
  }
}

function render(): void {
  renderComments(elements, state, {
    anonymousNickname: config.anonymousNickname,
    adminEnabled: Boolean(state.adminToken),
    onReply: setReplyTarget,
    onLike: (item) => void toggleLike(item),
    onDelete: (item) => void deleteComment(item)
  });
}

async function load(): Promise<void> {
  if (!state.imageId || !state.viewerId) return;
  if (state.loading) {
    state.loadAgain = true;
    return;
  }

  state.loading = true;
  state.loadError = '';
  const requestedImageId = state.imageId;
  elements.status.textContent = '';
  render();

  try {
    const response = await api.list(requestedImageId);
    if (requestedImageId === state.imageId) {
      state.comments = response.items;
      state.loadedImageId = requestedImageId;
    }
    bridge.post({
      type: 'comment-ui:loaded',
      imageId: requestedImageId,
      commentCount: response.items.length,
      commentedByMe: Boolean(response.commentedByMe) || hasLocalCommentedImage(requestedImageId)
    });
  } catch (error) {
    if (requestedImageId === state.imageId) {
      state.loadError = error instanceof Error ? error.message : '加载失败';
      state.loadedImageId = requestedImageId;
    }
    elements.status.textContent = state.loadError || '加载失败';
  } finally {
    state.loading = false;
    render();
    if (state.loadAgain) {
      state.loadAgain = false;
      void load();
    }
  }
}

async function publish(): Promise<void> {
  const rawName = elements.nickname.value.replace(/\s+/g, ' ').trim();
  const name = rawName || config.anonymousNickname;
  const content = elements.textarea.value.trim();
  if (!content || !state.imageId || !state.viewerId) return;

  elements.submit.disabled = true;
  elements.status.textContent = '';

  try {
    await api.publish({
      imageId: state.imageId,
      nickname: name,
      content,
      parentId: state.replyTo?.id || null
    });
    markLocalCommentedImage(state.imageId);

    if (rawName) localStorage.setItem(config.nicknameStorageKey, rawName);
    else localStorage.removeItem(config.nicknameStorageKey);
    elements.textarea.value = '';
    setReplyTarget(null);
    setPreview(false);
    await load();
  } catch (error) {
    if (error instanceof ApiError && error.message === 'nickname_change_cooldown') {
      elements.status.textContent = `您的昵称近期已修改过，${formatCooldown(error.retryAfterMs)}可再次修改`;
    } else {
      elements.status.textContent =
        error instanceof Error && error.message === 'rate_limited' ? '发送太快，请稍后再试' : '发布失败';
    }
  } finally {
    elements.submit.disabled = false;
  }
}

async function toggleLike(item: CommentItem): Promise<void> {
  if (pendingLikes.has(item.id)) return;
  const previous = { likedByMe: item.likedByMe, likeCount: item.likeCount };
  const nextLiked = !item.likedByMe;
  item.likedByMe = nextLiked;
  item.likeCount = Math.max(0, item.likeCount + (nextLiked ? 1 : -1));
  pendingLikes.add(item.id);
  render();
  try {
    const result = await api.setLike(item.id, nextLiked);
    item.likedByMe = result.likedByMe;
    item.likeCount = result.likeCount;
    render();
  } catch {
    item.likedByMe = previous.likedByMe;
    item.likeCount = previous.likeCount;
    render();
    elements.status.textContent = '操作失败';
  } finally {
    pendingLikes.delete(item.id);
  }
}

async function deleteComment(item: CommentItem): Promise<void> {
  if (!state.adminToken) return;
  try {
    await api.delete(item.id);
    await load();
  } catch {
    state.adminToken = '';
    render();
    elements.status.textContent = '验证已失效';
  }
}

function resetForImage(imageId: string): void {
  state.imageId = imageId;
  state.replyTo = null;
  state.comments = [];
  state.loadedImageId = '';
  state.loadError = '';
  elements.replyTarget.hidden = true;
  render();
}

window.addEventListener('message', (event) => {
  if (!bridge.acceptMessage(event)) return;
  const data = event.data as ParentMessage;

  if (data.type === 'normalpics:context' && data.imageId && data.viewerId) {
    const changed = state.imageId !== data.imageId;
    state.viewerId = data.viewerId;
    if (changed) {
      resetForImage(data.imageId);
      void load();
    }
    return;
  }

  if (data.type === 'normalpics:admin-token' && data.token) {
    state.adminToken = data.token;
    render();
    return;
  }

  if (data.type === 'normalpics:drag-channel' && event.ports[0]) {
    bridge.setDragPort(event.ports[0]);
    return;
  }

  if (data.type === 'normalpics:panel-reset') {
    panelPull.reset();
  }
});

elements.closeButton.addEventListener('click', () => bridge.post({ type: 'comment-ui:close' }));

let adminTapCount = 0;
let adminTapTimer = 0;
elements.commentTitle.addEventListener('click', () => {
  adminTapCount += 1;
  window.clearTimeout(adminTapTimer);
  if (adminTapCount >= 5) {
    adminTapCount = 0;
    bridge.post({ type: 'comment-ui:request-admin' });
    return;
  }
  adminTapTimer = window.setTimeout(() => {
    adminTapCount = 0;
  }, 1_500);
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    bridge.post({ type: 'comment-ui:request-admin' });
  }
});

elements.replyTarget.addEventListener('click', () => setReplyTarget(null));
elements.previewToggle.addEventListener('click', () => setPreview(!state.previewing));
elements.submit.addEventListener('click', () => void publish());
elements.textarea.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void publish();
});

bridge.post({ type: 'comment-ui:ready' });
