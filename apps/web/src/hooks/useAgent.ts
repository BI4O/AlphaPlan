/**
 * The chat transcript and the session event stream, as one hook.
 *
 * Component code should not deal with SSE or with the `ClientEvent` union; it asks for
 * `{ messages, tools, busy, send, abort }`.
 */

import { useCallback, useEffect, useState } from "react";
import { abortAgent, openEventStream, sendPrompt, type ClientEvent } from "../api.ts";

export interface Message {
	role: "user" | "assistant";
	text: string;
}

export interface AgentChat {
	messages: Message[];
	tools: string[];
	busy: boolean;
	send(text: string): void;
	abort(): void;
}

export function useAgent(): AgentChat {
	const [messages, setMessages] = useState<Message[]>([]);
	const [tools, setTools] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);

	useEffect(
		() =>
			openEventStream((event: ClientEvent) => {
				switch (event.type) {
					case "delta":
						setMessages((current) => {
							const last = current.at(-1);
							if (last?.role === "assistant") {
								return [...current.slice(0, -1), { role: "assistant", text: last.text + event.text }];
							}
							return [...current, { role: "assistant", text: event.text }];
						});
						break;
					case "tool_start":
						setTools((current) => [...current, event.name]);
						break;
					case "tool_end":
						setTools((current) => [...current, `${event.name} ${event.isError ? "failed" : "done"}`]);
						break;
					case "busy":
						setBusy(event.busy);
						break;
					case "settled":
						setBusy(false);
						break;
					case "error":
						setMessages((current) => [...current, { role: "assistant", text: `error: ${event.message}` }]);
						break;
				}
			}),
		[],
	);

	const send = useCallback((text: string) => {
		const trimmed = text.trim();
		if (trimmed === "") return;
		setMessages((current) => [...current, { role: "user", text: trimmed }]);
		void sendPrompt(trimmed);
	}, []);

	const abort = useCallback(() => void abortAgent(), []);

	return { messages, tools, busy, send, abort };
}
