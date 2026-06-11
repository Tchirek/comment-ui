export interface CommentItem {
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

export interface CommentAppState {
  imageId: string;
  viewerId: string;
  adminToken: string;
  replyTo: CommentItem | null;
  comments: CommentItem[];
  loadedImageId: string;
  loading: boolean;
  loadAgain: boolean;
  loadError: string;
  previewing: boolean;
}

export interface ParentMessage {
  type?: string;
  imageId?: string;
  viewerId?: string;
  token?: string;
}

export type PullPhase = 'start' | 'move' | 'end' | 'cancel';

export interface PullMessage {
  type: 'comment-ui:pull';
  phase: PullPhase;
  deltaY?: number;
  velocityY?: number;
}

export type ParentOutboundMessage =
  | { type: 'comment-ui:ready' }
  | { type: 'comment-ui:loaded'; imageId: string; commentCount: number; commentedByMe?: boolean }
  | { type: 'comment-ui:close' }
  | { type: 'comment-ui:request-admin' }
  | PullMessage;
