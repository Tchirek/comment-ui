import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import './style.css';

const API_ORIGIN = 'https://api.pics.tchirek.top';
const ALLOWED_PARENT_ORIGINS = new Set([
  'https://sicnu.pics.tchirek.top',
  'https://photohost-frontend.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
const NICKNAME_KEY = 'normalpics_comment_nickname';

interface CommentItem {
  id: string;
  imageId: string;
  rootId: string;
  parentId: string | null;
  nickname: string;
  operatingSystem: string;
  content: string;
  html: string;
  createdAt: number;
  likeCount: number;
  likedByMe: boolean;
}

let imageId = '';
let viewerId = '';
let adminToken = '';
let replyTo: CommentItem | null = null;
let comments: CommentItem[] = [];
let loading = false;
let loadAgain = false;
let previewing = false;
let pullTouchId: number | null = null;
let pullAnchorX = 0;
let pullAnchorY = 0;
let pullLastY = 0;
let pullLastAt = 0;
let pullVelocityY = 0;
let pullAtTop = false;
let pullingPanel = false;
let pullFrame = 0;
let queuedPullDistance: number | null = null;
let pullCurrentDistance = 0;
let dragPort: MessagePort | null = null;
const parentLocation = document.referrer || window.location.ancestorOrigins?.[0] || '';
let parentOrigin = parentLocation ? new URL(parentLocation).origin : '';

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <strong class="comment-title">评论</strong>
    <div class="header-actions">
      <button class="icon-button close" type="button" aria-label="关闭">×</button>
    </div>
  </header>
  <section class="composer">
    <input class="nickname" maxlength="32" autocomplete="nickname" placeholder="昵称">
    <div class="reply-target" hidden></div>
    <div class="editor-surface">
      <textarea maxlength="2000" placeholder="写下评论，支持 Markdown"></textarea>
      <div class="preview markdown" hidden></div>
    </div>
    <div class="composer-actions">
      <button class="text-button preview-toggle" type="button">预览</button>
      <span class="status" role="status"></span>
      <button class="submit" type="button">发布</button>
    </div>
  </section>
  <section class="comment-list" aria-live="polite"></section>
  <footer>Powered by <a href="https://github.com/Tchirek/comment-ui" target="_blank" rel="noreferrer">Sodesu</a> v0.5.2</footer>
`;

const commentTitle = app.querySelector<HTMLElement>('.comment-title')!;
const nickname = app.querySelector<HTMLInputElement>('.nickname')!;
const textarea = app.querySelector<HTMLTextAreaElement>('textarea')!;
const preview = app.querySelector<HTMLElement>('.preview')!;
const replyTarget = app.querySelector<HTMLElement>('.reply-target')!;
const status = app.querySelector<HTMLElement>('.status')!;
const list = app.querySelector<HTMLElement>('.comment-list')!;
const submit = app.querySelector<HTMLButtonElement>('.submit')!;
const previewToggle = app.querySelector<HTMLButtonElement>('.preview-toggle')!;
nickname.value = localStorage.getItem(NICKNAME_KEY) || '';

class ApiError extends Error {
  readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? Number(retryAfterMs) : null;
  }
}

function postParent(message: Record<string, unknown>): void {
  if (!parentOrigin || !ALLOWED_PARENT_ORIGINS.has(parentOrigin)) return;
  window.parent.postMessage(message, parentOrigin);
}

function scrollTop(): number {
  return app.scrollTop;
}

function touchX(touch: Touch): number {
  return Number.isFinite(touch.screenX) ? touch.screenX : touch.clientX;
}

function touchY(touch: Touch): number {
  return Number.isFinite(touch.screenY) ? touch.screenY : touch.clientY;
}

function clearPanelPullState(): void {
  pullTouchId = null;
  pullAtTop = false;
  pullingPanel = false;
  pullVelocityY = 0;
  pullCurrentDistance = 0;
  document.documentElement.classList.remove('panel-pulling');
}

function sendPull(message: Record<string, unknown>): void {
  if (dragPort) {
    dragPort.postMessage(message);
    return;
  }
  postParent(message);
}

function sendPullControl(message: Record<string, unknown>): void {
  postParent(message);
}

function queuePanelPull(deltaY: number): void {
  queuedPullDistance = Math.max(0, Math.min(window.innerHeight, deltaY));
  pullCurrentDistance = queuedPullDistance;
  if (pullFrame) return;
  pullFrame = requestAnimationFrame(() => {
    pullFrame = 0;
    if (queuedPullDistance === null) return;
    sendPull({ type: 'comment-ui:pull', phase: 'move', deltaY: queuedPullDistance });
    queuedPullDistance = null;
  });
}

function discardQueuedPanelPull(): void {
  if (pullFrame) cancelAnimationFrame(pullFrame);
  pullFrame = 0;
  queuedPullDistance = null;
}

function cancelPanelPull(notify = true): void {
  const wasPulling = pullingPanel;
  const deltaY = pullCurrentDistance;
  const velocityY = pullVelocityY;
  discardQueuedPanelPull();
  clearPanelPullState();
  if (!wasPulling) return;
  if (notify) sendPullControl({ type: 'comment-ui:pull', phase: 'cancel', deltaY, velocityY });
}

function headers(includeAdmin = false): HeadersInit {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Viewer-Id': viewerId
  };
  if (includeAdmin && adminToken) result.Authorization = `Bearer ${adminToken}`;
  return result;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string; retryAfterMs?: number };
  if (!response.ok) throw new ApiError(body.error || `request_${response.status}`, body.retryAfterMs);
  return body;
}

function safePreview(markdown: string): string {
  const html = micromark(markdown, {
    allowDangerousHtml: false,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  });
  const images = [...html.matchAll(/<img\s+[^>]*src="([^"]*)"[^>]*>/gi)];
  if (images.some((match) => !match[1].startsWith('https://'))) {
    return '<p class="preview-error">图片只允许安全 HTTPS 地址。</p>';
  }
  return html.replace(/<img\s+/gi, '<img loading="lazy" referrerpolicy="no-referrer" ');
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function macOSName(major: number): string {
  if (major === 15) return 'macOS 15 Sequoia';
  if (major === 14) return 'macOS 14 Sonoma';
  if (major === 13) return 'macOS 13 Ventura';
  if (major === 12) return 'macOS 12 Monterey';
  return major > 0 ? `macOS ${major}` : 'macOS';
}

async function detectOperatingSystem(): Promise<string> {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string }>;
    };
  }).userAgentData;
  let platform = uaData?.platform || navigator.platform || '';
  let platformVersion = '';
  try {
    const values = await uaData?.getHighEntropyValues?.(['platform', 'platformVersion']);
    platform = values?.platform || platform;
    platformVersion = values?.platformVersion || '';
  } catch {
    // Reduced user-agent data remains sufficient for the fallback detector.
  }

  const android = ua.match(/Android[ /](\d{1,2})/i);
  if (android) return `Android ${android[1]}`;
  const ios = ua.match(/(?:iPhone )?OS (\d{1,2})[_\d]*/i);
  if (/iPad/i.test(ua) && ios) return `iPadOS ${ios[1]}`;
  if (ios) return `iOS ${ios[1]}`;
  if (/Windows/i.test(platform) || /Windows NT/i.test(ua)) {
    const platformMajor = Number.parseInt(platformVersion.split('.')[0] || '', 10);
    if (Number.isFinite(platformMajor)) return platformMajor >= 13 ? 'Windows 11' : 'Windows 10';
    if (/Windows NT 6\.3/i.test(ua)) return 'Windows 8.1';
    if (/Windows NT 6\.2/i.test(ua)) return 'Windows 8';
    if (/Windows NT 6\.1/i.test(ua)) return 'Windows 7';
    return 'Windows 10';
  }
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Ubuntu/i.test(ua)) return 'Ubuntu';
  if (/Arch(?: Linux)?/i.test(ua)) return 'Arch Linux';
  if (/Deepin/i.test(ua)) return 'Deepin';
  if (/Fedora/i.test(ua)) return 'Fedora';
  if (/macOS|Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
    const highEntropyMajor = Number.parseInt(platformVersion.split('.')[0] || '', 10);
    const uaMajor = Number.parseInt(ua.match(/Mac OS X (\d{1,2})/)?.[1] || '', 10);
    return macOSName(Number.isFinite(highEntropyMajor) ? highEntropyMajor : uaMajor);
  }
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'Linux';
  return '未知系统';
}

function formatCooldown(value: number | null): string {
  const milliseconds = Math.max(1_000, value || 0);
  const hours = Math.ceil(milliseconds / 3_600_000);
  return hours >= 24 ? `约 ${Math.ceil(hours / 24)} 天后` : `约 ${hours} 小时后`;
}

function nicknameInitial(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '?';
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment || '?';
  }
  return Array.from(trimmed)[0] || '?';
}

function nicknameHue(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

function commentRank(a: CommentItem, b: CommentItem): number {
  const aHasLikes = a.likeCount > 0;
  const bHasLikes = b.likeCount > 0;
  if (aHasLikes !== bHasLikes) return aHasLikes ? -1 : 1;
  if (aHasLikes && a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
  return b.createdAt - a.createdAt;
}

function commentNode(item: CommentItem, reply = false): HTMLElement {
  const article = document.createElement('article');
  article.className = reply ? 'comment reply' : 'comment';
  article.dataset.id = item.id;

  const avatar = document.createElement('div');
  avatar.className = 'comment-avatar';
  avatar.textContent = nicknameInitial(item.nickname);
  avatar.style.setProperty('--avatar-hue', String(nicknameHue(item.nickname)));
  avatar.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'comment-main';
  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('strong');
  name.textContent = item.nickname;
  const time = document.createElement('time');
  time.dateTime = new Date(item.createdAt).toISOString();
  time.textContent = formatTime(item.createdAt);
  const operatingSystem = document.createElement('span');
  operatingSystem.className = 'comment-os';
  operatingSystem.textContent = item.operatingSystem || '未知系统';
  head.append(name, operatingSystem, time);

  const body = document.createElement('div');
  body.className = 'markdown';
  body.innerHTML = item.html;

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  const replyButton = document.createElement('button');
  replyButton.type = 'button';
  replyButton.textContent = '回复';
  replyButton.addEventListener('click', () => {
    replyTo = item;
    replyTarget.hidden = false;
    replyTarget.textContent = `回复 ${item.nickname} · 点击取消`;
    textarea.focus();
  });
  const likeButton = document.createElement('button');
  likeButton.type = 'button';
  likeButton.className = `like-button${item.likedByMe ? ' liked' : ''}`;
  likeButton.title = '喜欢';
  likeButton.setAttribute('aria-label', '喜欢');
  likeButton.setAttribute('aria-pressed', item.likedByMe ? 'true' : 'false');
  likeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6z"/></svg>${item.likeCount > 0 ? `<span>${item.likeCount}</span>` : ''}`;
  likeButton.addEventListener('click', () => void toggleLike(item));
  actions.append(replyButton, likeButton);

  if (adminToken) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => void deleteComment(item));
    actions.append(deleteButton);
  }

  main.append(head, body, actions);
  article.append(avatar, main);
  return article;
}

function render(): void {
  list.replaceChildren();
  const roots = comments.filter((item) => item.parentId === null).sort(commentRank);
  const rootOrder = new Map(roots.map((item, index) => [item.id, index]));
  for (const root of roots) {
    const thread = document.createElement('div');
    thread.className = 'thread';
    thread.appendChild(commentNode(root));
    const replies = comments
      .filter((item) => item.parentId !== null && item.rootId === root.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const reply of replies) thread.appendChild(commentNode(reply, true));
    list.appendChild(thread);
  }
  const orphans = comments.filter((item) => item.parentId !== null && !rootOrder.has(item.rootId));
  for (const item of orphans) list.appendChild(commentNode(item, true));
  if (!loading && comments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有评论';
    list.appendChild(empty);
  }
}

async function load(): Promise<void> {
  if (!imageId || !viewerId) return;
  if (loading) {
    loadAgain = true;
    return;
  }
  loading = true;
  const requestedImageId = imageId;
  status.textContent = '';
  try {
    const response = await request<{ items: CommentItem[] }>(
      `/api/comment?imageId=${encodeURIComponent(imageId)}`,
      { headers: headers() }
    );
    if (requestedImageId === imageId) comments = response.items;
    postParent({ type: 'comment-ui:loaded', imageId: requestedImageId, commentCount: response.items.length });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '加载失败';
  } finally {
    loading = false;
    render();
    if (loadAgain) {
      loadAgain = false;
      void load();
    }
  }
}

async function publish(): Promise<void> {
  const name = nickname.value.replace(/\s+/g, ' ').trim();
  const content = textarea.value.trim();
  if (!name || !content || !imageId || !viewerId) return;
  submit.disabled = true;
  status.textContent = '';
  try {
    const operatingSystem = await detectOperatingSystem();
    await request('/api/comment', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        imageId,
        nickname: name,
        content,
        parentId: replyTo?.id || null,
        operatingSystem
      })
    });
    localStorage.setItem(NICKNAME_KEY, name);
    textarea.value = '';
    replyTo = null;
    replyTarget.hidden = true;
    setPreview(false);
    await load();
  } catch (error) {
    if (error instanceof ApiError && error.message === 'nickname_change_cooldown') {
      status.textContent = `您的昵称近期已修改过，${formatCooldown(error.retryAfterMs)}可再次修改`;
    } else {
      status.textContent = error instanceof Error && error.message === 'rate_limited' ? '发送太快，请稍后再试' : '发布失败';
    }
  } finally {
    submit.disabled = false;
  }
}

async function toggleLike(item: CommentItem): Promise<void> {
  try {
    const result = await request<{ likedByMe: boolean; likeCount: number }>(`/api/comment/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ liked: !item.likedByMe })
    });
    item.likedByMe = result.likedByMe;
    item.likeCount = result.likeCount;
    render();
  } catch {
    status.textContent = '操作失败';
  }
}

async function deleteComment(item: CommentItem): Promise<void> {
  if (!adminToken) return;
  try {
    await request(`/api/comment/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: headers(true)
    });
    await load();
  } catch {
    adminToken = '';
    render();
    status.textContent = '验证已失效';
  }
}

function setPreview(visible: boolean): void {
  previewing = visible;
  preview.hidden = !visible;
  textarea.hidden = visible;
  previewToggle.textContent = visible ? '编辑' : '预览';
  if (visible) preview.innerHTML = safePreview(textarea.value);
}

window.addEventListener('message', (event) => {
  if (!ALLOWED_PARENT_ORIGINS.has(event.origin) || event.source !== window.parent) return;
  parentOrigin = event.origin;
  const data = event.data as { type?: string; imageId?: string; viewerId?: string; token?: string };
  if (data.type === 'normalpics:context' && data.imageId && data.viewerId) {
    const changed = imageId !== data.imageId;
    imageId = data.imageId;
    viewerId = data.viewerId;
    if (changed) {
      replyTo = null;
      replyTarget.hidden = true;
      comments = [];
      render();
      void load();
    }
  }
  if (data.type === 'normalpics:admin-token' && data.token) {
    adminToken = data.token;
    render();
  }
  if (data.type === 'normalpics:drag-channel' && event.ports[0]) {
    dragPort?.close();
    dragPort = event.ports[0];
    dragPort.start();
  }
  if (data.type === 'normalpics:panel-reset') {
    discardQueuedPanelPull();
    clearPanelPullState();
  }
});

app.querySelector('.close')!.addEventListener('click', () => postParent({ type: 'comment-ui:close' }));
let adminTapCount = 0;
let adminTapTimer = 0;
commentTitle.addEventListener('click', () => {
  adminTapCount += 1;
  window.clearTimeout(adminTapTimer);
  if (adminTapCount >= 5) {
    adminTapCount = 0;
    postParent({ type: 'comment-ui:request-admin' });
    return;
  }
  adminTapTimer = window.setTimeout(() => {
    adminTapCount = 0;
  }, 1_500);
});
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    postParent({ type: 'comment-ui:request-admin' });
  }
});
replyTarget.addEventListener('click', () => {
  replyTo = null;
  replyTarget.hidden = true;
});
previewToggle.addEventListener('click', () => setPreview(!previewing));
submit.addEventListener('click', () => void publish());
textarea.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void publish();
});

document.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) {
    cancelPanelPull();
    return;
  }
  if (event.target instanceof Element && event.target.closest('input, textarea, button, a')) {
    cancelPanelPull(false);
    return;
  }
  const touch = event.touches[0];
  pullTouchId = touch.identifier;
  pullAnchorX = touchX(touch);
  pullAnchorY = touchY(touch);
  pullLastY = touchY(touch);
  pullLastAt = performance.now();
  pullVelocityY = 0;
  pullAtTop = scrollTop() <= 1;
  pullingPanel = false;
}, { capture: true, passive: true });

document.addEventListener('touchmove', (event) => {
  if (pullTouchId === null || event.touches.length !== 1) return;
  const touch = Array.from(event.touches).find((item) => item.identifier === pullTouchId);
  if (!touch) return;

  const now = performance.now();
  const currentX = touchX(touch);
  const currentY = touchY(touch);
  const atTop = scrollTop() <= 1;
  if (!pullingPanel && !atTop) {
    pullAtTop = false;
    pullAnchorX = currentX;
    pullAnchorY = currentY;
    pullLastY = currentY;
    pullLastAt = now;
    return;
  }
  if (!pullAtTop) {
    pullAtTop = true;
    pullAnchorX = currentX;
    pullAnchorY = currentY;
    pullLastY = currentY;
    pullLastAt = now;
    return;
  }

  const deltaX = currentX - pullAnchorX;
  const deltaY = Math.max(0, currentY - pullAnchorY);
  if (!pullingPanel) {
    if (deltaY <= 7 || Math.abs(deltaY) <= Math.abs(deltaX) * 1.15) return;
    pullingPanel = true;
    document.documentElement.classList.add('panel-pulling');
    sendPullControl({ type: 'comment-ui:pull', phase: 'start' });
  }

  event.preventDefault();
  const elapsed = Math.max(8, now - pullLastAt);
  pullVelocityY = (currentY - pullLastY) / elapsed;
  pullLastY = currentY;
  pullLastAt = now;
  queuePanelPull(deltaY);
}, { capture: true, passive: false });

document.addEventListener('touchend', (event) => {
  if (pullTouchId === null) return;
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === pullTouchId);
  if (!touch) return;
  const deltaY = Math.max(0, touchY(touch) - pullAnchorY);
  if (pullingPanel) {
    event.preventDefault();
    discardQueuedPanelPull();
    clearPanelPullState();
    sendPullControl({ type: 'comment-ui:pull', phase: 'end', deltaY, velocityY: pullVelocityY });
    return;
  }
  clearPanelPullState();
}, { capture: true, passive: false });

document.addEventListener('touchcancel', () => cancelPanelPull(), { capture: true });

postParent({ type: 'comment-ui:ready' });
