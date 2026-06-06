import type { createParentBridge } from './parentBridge';

type ParentBridge = ReturnType<typeof createParentBridge>;

function touchX(touch: Touch): number {
  return Number.isFinite(touch.screenX) ? touch.screenX : touch.clientX;
}

function touchY(touch: Touch): number {
  return Number.isFinite(touch.screenY) ? touch.screenY : touch.clientY;
}

export function installPanelPull(app: HTMLElement, bridge: ParentBridge) {
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

  function scrollTop(): number {
    return app.scrollTop;
  }

  function clearState(): void {
    pullTouchId = null;
    pullAtTop = false;
    pullingPanel = false;
    pullVelocityY = 0;
    pullCurrentDistance = 0;
    document.documentElement.classList.remove('panel-pulling');
  }

  function discardQueuedPull(): void {
    if (pullFrame) cancelAnimationFrame(pullFrame);
    pullFrame = 0;
    queuedPullDistance = null;
  }

  function queuePull(deltaY: number): void {
    queuedPullDistance = Math.max(0, Math.min(window.innerHeight, deltaY));
    pullCurrentDistance = queuedPullDistance;
    if (pullFrame) return;
    pullFrame = requestAnimationFrame(() => {
      pullFrame = 0;
      if (queuedPullDistance === null) return;
      bridge.postPull({ type: 'comment-ui:pull', phase: 'move', deltaY: queuedPullDistance });
      queuedPullDistance = null;
    });
  }

  function cancel(notify = true): void {
    const wasPulling = pullingPanel;
    const deltaY = pullCurrentDistance;
    const velocityY = pullVelocityY;
    discardQueuedPull();
    clearState();
    if (wasPulling && notify) {
      bridge.postPull({ type: 'comment-ui:pull', phase: 'cancel', deltaY, velocityY });
    }
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    if (event.target instanceof Element && event.target.closest('input, textarea, button, a')) {
      cancel(false);
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
  }

  function onTouchMove(event: TouchEvent): void {
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
      bridge.postPull({ type: 'comment-ui:pull', phase: 'start' });
    }

    event.preventDefault();
    const elapsed = Math.max(8, now - pullLastAt);
    pullVelocityY = (currentY - pullLastY) / elapsed;
    pullLastY = currentY;
    pullLastAt = now;
    queuePull(deltaY);
  }

  function onTouchEnd(event: TouchEvent): void {
    if (pullTouchId === null) return;
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === pullTouchId);
    if (!touch) return;
    const deltaY = Math.max(0, touchY(touch) - pullAnchorY);
    if (pullingPanel) {
      event.preventDefault();
      discardQueuedPull();
      clearState();
      bridge.postPull({ type: 'comment-ui:pull', phase: 'end', deltaY, velocityY: pullVelocityY });
      return;
    }
    clearState();
  }

  function onTouchCancel(): void {
    cancel();
  }

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { capture: true });

  return {
    reset(): void {
      discardQueuedPull();
      clearState();
    },

    destroy(): void {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      cancel(false);
    }
  };
}
