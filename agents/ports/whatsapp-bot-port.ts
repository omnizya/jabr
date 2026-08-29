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
          messages?: Array<{
            from: string; // User phone number (E.164)
            id: string;   // Message ID (for dedup)
            timestamp: string;
            text?: { body: string };
          }>;
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

  // ---- Mark message as read ----
  markAsRead(messageId: string): Promise<void>;
}
