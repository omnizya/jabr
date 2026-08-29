export type WhatsAppMessageType = 'text' | 'image' | 'audio' | 'document' | 'video' | 'sticker' | 'location' | 'interactive';

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppInteractiveMessage {
  type: 'button' | 'list';
  header: string;
  body: string;
  footer?: string;
  buttons: WhatsAppButton[];
}

export type WhatsAppMessageContentType = 'text' | 'image' | 'audio' | 'document' | 'video' | 'sticker' | 'location' | 'interactive';

export interface WhatsAppTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text';
  text: { body: string };
}

export interface WhatsAppImageMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'image';
  image: { id: string; caption?: string };
}

export interface WhatsAppAudioMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'audio';
  audio: { id: string };
}

export interface WhatsAppDocumentMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'document';
  document: { id: string; filename?: string; caption?: string };
}

export interface WhatsAppVideoMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'video';
  video: { id: string; caption?: string };
}

export interface WhatsAppStickerMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'sticker';
  sticker: { id: string };
}

export interface WhatsAppLocationMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'location';
  location: { latitude: number; longitude: number; address?: string };
}

export interface WhatsAppInteractiveMessagePayload {
  from: string;
  id: string;
  timestamp: string;
  type: 'interactive';
  interactive: {
    type: string;
    sender_name?: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

/** Union of all WhatsApp Cloud message types delivered via webhook. */
export type WhatsAppInboundMessage =
  | WhatsAppTextMessage
  | WhatsAppImageMessage
  | WhatsAppAudioMessage
  | WhatsAppDocumentMessage
  | WhatsAppVideoMessage
  | WhatsAppStickerMessage
  | WhatsAppLocationMessage
  | WhatsAppInteractiveMessagePayload;

export function isTextMessage(msg: WhatsAppInboundMessage): msg is WhatsAppTextMessage {
  return msg.type === 'text';
}
export function isImageMessage(msg: WhatsAppInboundMessage): msg is WhatsAppImageMessage {
  return msg.type === 'image';
}
export function isAudioMessage(msg: WhatsAppInboundMessage): msg is WhatsAppAudioMessage {
  return msg.type === 'audio';
}
export function isDocumentMessage(msg: WhatsAppInboundMessage): msg is WhatsAppDocumentMessage {
  return msg.type === 'document';
}
export function isVideoMessage(msg: WhatsAppInboundMessage): msg is WhatsAppVideoMessage {
  return msg.type === 'video';
}
export function isStickerMessage(msg: WhatsAppInboundMessage): msg is WhatsAppStickerMessage {
  return msg.type === 'sticker';
}
export function isLocationMessage(msg: WhatsAppInboundMessage): msg is WhatsAppLocationMessage {
  return msg.type === 'location';
}
export function isInteractiveMessage(msg: WhatsAppInboundMessage): msg is WhatsAppInteractiveMessagePayload {
  return msg.type === 'interactive';
}

export interface WhatsAppWebhookEvent {
  source: 'whatsapp';
  type: 'message' | 'status';
  payload: {
    entry: Array<{
      id: string; // Business account ID
      changes: Array<{
        value: {
          messaging_product: 'whatsapp';
          metadata: { display_phone_number: string; phone_number_id: string };
          messages?: WhatsAppInboundMessage[];
          statuses?: Array<{
            id: string;
            recipient_id: string;
            status: 'sent' | 'delivered' | 'read' | 'failed';
            timestamp: string;
          }>;
        };
      }>;
    }>;
  };
  sessionId: string; // User phone number for conversation continuity
}

export interface WhatsAppTemplateComponent {
  type: "header" | "body" | "footer";
  parameters?: Array<{
    type: "text" | "image" | "video" | "document";
    text?: string;
    media?: { link?: string };
    fallback?: string;
  }>;
}

export interface WhatsAppTemplateMessage {
  /** WhatsApp template name (pre-approved in Meta Business Suite). */
  name: string;
  /**
   * BCP 47 language code, e.g. "en_US", "fr", "ar".
   * @default "en_US"
   */
  languageCode?: string;
  /** Optional header/body/footer component parameters. */
  components?: WhatsAppTemplateComponent[];
}

export interface WhatsAppBotPort {
  // ---- Send text message ----
  sendMessage(to: string, text: string): Promise<void>;

  // ---- Send interactive message (buttons, lists) ----
  sendInteractiveMessage(
    to: string,
    message: WhatsAppInteractiveMessage,
  ): Promise<void>;

  // ---- Send document ----
  sendDocument(to: string, document: Buffer, filename: string): Promise<void>;

  // ---- Send pre-approved template message ----
  sendTemplateMessage(to: string, template: WhatsAppTemplateMessage): Promise<void>;

  // ---- Mark message as read ----
  markAsRead(messageId: string): Promise<void>;
}
