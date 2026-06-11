import type { CommentUiConfig } from './config';
import type { ParentOutboundMessage, PullMessage } from './types';

function initialParentOrigin(): string {
  const ancestorOrigins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const candidates = [document.referrer, ancestorOrigins?.[0]].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return new URL(candidate).origin;
    } catch {
      // Try the next source.
    }
  }
  return '';
}

export function createParentBridge(config: CommentUiConfig) {
  let parentOrigin = initialParentOrigin();
  let dragPort: MessagePort | null = null;

  function canPost(): boolean {
    return Boolean(parentOrigin && config.allowedParentOrigins.has(parentOrigin));
  }

  function post(message: ParentOutboundMessage): void {
    if (!canPost()) return;
    window.parent.postMessage(message, parentOrigin);
  }

  function postPull(message: PullMessage): void {
    if (dragPort && message.phase === 'move') {
      dragPort.postMessage(message);
      return;
    }
    post(message);
  }

  function acceptMessage(event: MessageEvent): boolean {
    if (event.source !== window.parent) return false;
    if (!config.allowedParentOrigins.has(event.origin)) return false;
    parentOrigin = event.origin;
    return true;
  }

  function setDragPort(port: MessagePort): void {
    dragPort?.close();
    dragPort = port;
    dragPort.start();
  }

  return {
    post,
    postPull,
    acceptMessage,
    setDragPort
  };
}

