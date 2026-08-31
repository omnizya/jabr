export type TelegramParseMode = "Markdown" | "HTML";

export type TelegramChatAction =
	| "typing"
	| "upload_document"
	| "upload_photo"
	| "record_video"
	| "record_voice";

export interface TelegramInlineKeyboardButton {
	text: string;
	url?: string;
	callback_data?: string;
	login_url?: {
		url: string;
		provider_token?: string;
		write_access_token?: string;
	};
	pay?: string;
	switch_inline_query?: string;
	switch_inline_query_current_chat?: string;
}

export interface TelegramInlineKeyboard {
	inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramReplyMarkup {
	reply_markup: TelegramInlineKeyboard | string;
}

export interface TelegramBotPort {
	// ---- Sending messages ----
	sendMessage(
		chatId: number,
		text: string,
		options?: {
			parse_mode?: TelegramParseMode;
			reply_markup?: TelegramInlineKeyboard;
		},
	): Promise<void>;

	// ---- Typing indicators ----
	sendChatAction(chatId: number, action: TelegramChatAction): Promise<void>;

	// ---- Inline keyboards / callback queries ----
	answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;

	// ---- Webhook setup ----
	setWebhook(url: string, secretToken?: string): Promise<void>;

	deleteWebhook(): Promise<void>;
}

console.log("[TelegramBotPort] port interface loaded");
