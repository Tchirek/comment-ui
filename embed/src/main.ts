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
let sort = 'latest';
let loading = false;
let loadAgain = false;
let previewing = false;
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '';

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <strong>评论</strong>
    <div class="header-actions">
      <select aria-label="排序">
        <option value="latest">最新</option>
        <option value="oldest">最早</option>
        <option value="popular">喜欢最多</option>
      </select>
      <button class="text-button admin" type="button">管理</button>
      <button class="icon-button close" type="button" aria-label="关闭">×</button>
    </div>
  </header>
  <section class="composer">
    <input class="nickname" maxlength="32" autocomplete="nickname" placeholder="昵称">
    <div class="reply-target" hidden></div>
    <textarea maxlength="2000" placeholder="写下评论，支持 Markdown"></textarea>
    <div class="preview markdown" hidden></div>
    <div class="composer-actions">
      <button class="text-button preview-toggle" type="button">预览</button>
      <span class="status" role="status"></span>
      <button class="submit" type="button">发布</button>
    </div>
  </section>
  <section class="comment-list" aria-live="polite"></section>
  <footer><a href="https://github.com/Tchirek/comment-ui" target="_blank" rel="noreferrer">源代码</a></footer>
`;

const sortSelect = app.querySelector<HTMLSelectElement>('select')!;
const nickname = app.querySelector<HTMLInputElement>('.nickname')!;
const textarea = app.querySelector<HTMLTextAreaElement>('textarea')!;
const preview = app.querySelector<HTMLElement>('.preview')!;
const replyTarget = app.querySelector<HTMLElement>('.reply-target')!;
const status = app.querySelector<HTMLElement>('.status')!;
const list = app.querySelector<HTMLElement>('.comment-list')!;
const submit = app.querySelector<HTMLButtonElement>('.submit')!;
const previewToggle = app.querySelector<HTMLButtonElement>('.preview-toggle')!;
const adminButton = app.querySelector<HTMLButtonElement>('.admin')!;
nickname.value = localStorage.getItem(NICKNAME_KEY) || '';

function postParent(message: Record<string, unknown>): void {
  if (!parentOrigin || !ALLOWED_PARENT_ORIGINS.has(parentOrigin)) return;
  window.parent.postMessage(message, parentOrigin);
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
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `request_${response.status}`);
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

function commentNode(item: CommentItem, reply = false): HTMLElement {
  const article = document.createElement('article');
  article.className = reply ? 'comment reply' : 'comment';
  article.dataset.id = item.id;

  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('strong');
  name.textContent = item.nickname;
  const time = document.createElement('time');
  time.dateTime = new Date(item.createdAt).toISOString();
  time.textContent = formatTime(item.createdAt);
  head.append(name, time);

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
  likeButton.className = item.likedByMe ? 'liked' : '';
  likeButton.textContent = item.likeCount > 0 ? `喜欢 ${item.likeCount}` : '喜欢';
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

  article.append(head, body, actions);
  return article;
}

function render(): void {
  list.replaceChildren();
  const roots = comments.filter((item) => item.parentId === null);
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
      `/api/comment?imageId=${encodeURIComponent(imageId)}&sort=${encodeURIComponent(sort)}`,
      { headers: headers() }
    );
    if (requestedImageId === imageId) comments = response.items;
    postParent({ type: 'comment-ui:loaded', imageId: requestedImageId });
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
    localStorage.setItem(NICKNAME_KEY, name);
    await request('/api/comment', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        imageId,
        nickname: name,
        content,
        parentId: replyTo?.id || null
      })
    });
    textarea.value = '';
    replyTo = null;
    replyTarget.hidden = true;
    setPreview(false);
    await load();
  } catch (error) {
    status.textContent = error instanceof Error && error.message === 'rate_limited' ? '发送太快，请稍后再试' : '发布失败';
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
    adminButton.textContent = '管理';
    render();
    status.textContent = '管理权限已失效';
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
    adminButton.textContent = '管理中';
    render();
  }
});

sortSelect.addEventListener('change', () => {
  sort = sortSelect.value;
  void load();
});
app.querySelector('.close')!.addEventListener('click', () => postParent({ type: 'comment-ui:close' }));
adminButton.addEventListener('click', () => postParent({ type: 'comment-ui:request-admin' }));
replyTarget.addEventListener('click', () => {
  replyTo = null;
  replyTarget.hidden = true;
});
previewToggle.addEventListener('click', () => setPreview(!previewing));
submit.addEventListener('click', () => void publish());
textarea.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void publish();
});

postParent({ type: 'comment-ui:ready' });
