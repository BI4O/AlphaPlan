import { useEffect, useRef, useState } from "react";
import type { AgentChat } from "../hooks/useAgent.ts";

export function Chat({ chat }: { chat: AgentChat }) {
	const [draft, setDraft] = useState("");
	const endRef = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [chat.messages, chat.tools]);

	const submit = () => {
		if (draft.trim() === "") return;
		chat.send(draft);
		setDraft("");
	};

	return (
		<section className="chat">
			<div className="messages">
				{chat.messages.length === 0 && (
					<p className="muted">
						Ask about balances, quotes, transaction history, DeFi positions. This session cannot move funds.
					</p>
				)}
				{chat.messages.map((message, index) => (
					<div key={index} className={"msg " + message.role}>
						<pre>{message.text}</pre>
					</div>
				))}
				{chat.tools.length > 0 && (
					<div className="tools">
						{chat.tools.map((tool, index) => (
							<span key={index} className="chip">
								{tool}
							</span>
						))}
					</div>
				)}
				<span ref={endRef} />
			</div>

			<form
				className="composer"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<textarea
					value={draft}
					placeholder={chat.busy ? "the agent is working — this message will be queued" : "问点什么…"}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
				/>
				<div className="composer-actions">
					<button type="submit" disabled={chat.busy || draft.trim() === ""}>
						{chat.busy ? "排队" : "发送"}
					</button>
					{chat.busy && (
						<button type="button" className="ghost" onClick={chat.abort}>
							停止
						</button>
					)}
				</div>
			</form>
		</section>
	);
}
