import type { CommentUiConfig } from './config';

export interface CommentElements {
  app: HTMLElement;
  commentTitle: HTMLElement;
  nickname: HTMLInputElement;
  textarea: HTMLTextAreaElement;
  preview: HTMLElement;
  replyTarget: HTMLElement;
  status: HTMLElement;
  list: HTMLElement;
  submit: HTMLButtonElement;
  previewToggle: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing_element:${selector}`);
  return element;
}

export function mountApp(app: HTMLElement, config: CommentUiConfig): CommentElements {
  app.innerHTML = `
    <header>
      <strong class="comment-title"></strong>
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
    <footer>Powered by <a class="source-link" target="_blank" rel="noreferrer">Sodesu</a> v0.5.2</footer>
  `;

  const elements: CommentElements = {
    app,
    commentTitle: requireElement(app, '.comment-title'),
    nickname: requireElement(app, '.nickname'),
    textarea: requireElement(app, 'textarea'),
    preview: requireElement(app, '.preview'),
    replyTarget: requireElement(app, '.reply-target'),
    status: requireElement(app, '.status'),
    list: requireElement(app, '.comment-list'),
    submit: requireElement(app, '.submit'),
    previewToggle: requireElement(app, '.preview-toggle'),
    closeButton: requireElement(app, '.close')
  };

  elements.commentTitle.textContent = config.title;
  elements.nickname.value = localStorage.getItem(config.nicknameStorageKey) || '';
  requireElement<HTMLAnchorElement>(app, '.source-link').href = config.sourceRepoUrl;
  return elements;
}

