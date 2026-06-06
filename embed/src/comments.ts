import type { CommentElements } from './dom';
import type { CommentAppState, CommentItem } from './types';

interface CommentRenderOptions {
  anonymousNickname: string;
  adminEnabled: boolean;
  onReply: (item: CommentItem) => void;
  onLike: (item: CommentItem) => void;
  onDelete: (item: CommentItem) => void;
}

export function commentNickname(value: string, anonymousNickname: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || anonymousNickname;
}

function nicknameInitial(value: string, anonymousNickname: string): string {
  const trimmed = commentNickname(value, anonymousNickname);
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment || '?';
  }
  return Array.from(trimmed)[0] || '?';
}

function nicknameHue(value: string, anonymousNickname: string): number {
  let hash = 0;
  for (const character of commentNickname(value, anonymousNickname)) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 360;
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function commentRank(a: CommentItem, b: CommentItem): number {
  const aHasLikes = a.likeCount > 0;
  const bHasLikes = b.likeCount > 0;
  if (aHasLikes !== bHasLikes) return aHasLikes ? -1 : 1;
  if (aHasLikes && a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
  return b.createdAt - a.createdAt;
}

function createCommentNode(
  item: CommentItem,
  elements: CommentElements,
  options: CommentRenderOptions,
  reply = false
): HTMLElement {
  const article = document.createElement('article');
  article.className = reply ? 'comment reply' : 'comment';
  article.dataset.id = item.id;
  const displayName = commentNickname(item.nickname, options.anonymousNickname);

  const avatar = document.createElement('div');
  avatar.className = 'comment-avatar';
  avatar.textContent = nicknameInitial(displayName, options.anonymousNickname);
  avatar.style.setProperty('--avatar-hue', String(nicknameHue(displayName, options.anonymousNickname)));
  avatar.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'comment-main';

  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('strong');
  name.textContent = displayName;
  const operatingSystem = document.createElement('span');
  operatingSystem.className = 'comment-os';
  operatingSystem.textContent = item.operatingSystem || '未知系统';
  const time = document.createElement('time');
  time.dateTime = new Date(item.createdAt).toISOString();
  time.textContent = formatTime(item.createdAt);
  head.append(name, operatingSystem, time);

  const body = document.createElement('div');
  body.className = 'markdown';
  body.innerHTML = item.html;

  const actions = document.createElement('div');
  actions.className = 'comment-actions';

  const replyButton = document.createElement('button');
  replyButton.type = 'button';
  replyButton.textContent = '回复';
  replyButton.addEventListener('click', () => options.onReply(item));

  const likeButton = document.createElement('button');
  likeButton.type = 'button';
  likeButton.className = `like-button${item.likedByMe ? ' liked' : ''}`;
  likeButton.title = '喜欢';
  likeButton.setAttribute('aria-label', '喜欢');
  likeButton.setAttribute('aria-pressed', item.likedByMe ? 'true' : 'false');
  likeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6z"/></svg>${item.likeCount > 0 ? `<span>${item.likeCount}</span>` : ''}`;
  likeButton.addEventListener('click', () => options.onLike(item));
  actions.append(replyButton, likeButton);

  if (options.adminEnabled) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => options.onDelete(item));
    actions.append(deleteButton);
  }

  main.append(head, body, actions);
  article.append(avatar, main);
  return article;
}

function renderSkeleton(list: HTMLElement): void {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 3; index += 1) {
    const article = document.createElement('article');
    article.className = `comment skeleton-comment${index === 1 ? ' reply' : ''}`;
    article.setAttribute('aria-hidden', 'true');

    const avatar = document.createElement('div');
    avatar.className = 'skeleton skeleton-avatar';

    const main = document.createElement('div');
    main.className = 'comment-main';
    const head = document.createElement('div');
    head.className = 'comment-head';
    const name = document.createElement('span');
    name.className = 'skeleton skeleton-name';
    const meta = document.createElement('span');
    meta.className = 'skeleton skeleton-meta';
    head.append(name, meta);

    const lineA = document.createElement('div');
    lineA.className = 'skeleton skeleton-line';
    const lineB = document.createElement('div');
    lineB.className = 'skeleton skeleton-line short';
    main.append(head, lineA, lineB);
    article.append(avatar, main);
    fragment.appendChild(article);
  }
  list.appendChild(fragment);
}

export function renderComments(
  elements: CommentElements,
  state: CommentAppState,
  options: CommentRenderOptions
): void {
  elements.list.replaceChildren();

  const loaded = Boolean(state.imageId) && state.loadedImageId === state.imageId;
  if (!loaded) {
    renderSkeleton(elements.list);
    return;
  }

  const roots = state.comments.filter((item) => item.parentId === null).sort(commentRank);
  const rootOrder = new Map(roots.map((item, index) => [item.id, index]));

  for (const root of roots) {
    const thread = document.createElement('div');
    thread.className = 'thread';
    thread.appendChild(createCommentNode(root, elements, options));
    const replies = state.comments
      .filter((item) => item.parentId !== null && item.rootId === root.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const reply of replies) thread.appendChild(createCommentNode(reply, elements, options, true));
    elements.list.appendChild(thread);
  }

  const orphans = state.comments.filter((item) => item.parentId !== null && !rootOrder.has(item.rootId));
  for (const item of orphans) {
    elements.list.appendChild(createCommentNode(item, elements, options, true));
  }

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'empty';
    error.textContent = state.loadError;
    elements.list.appendChild(error);
  } else if (!state.loading && state.comments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有评论';
    elements.list.appendChild(empty);
  }
}
