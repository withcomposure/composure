import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import { ArrowDown, Search, Send } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { fmtTime } from '@/utils/format-time'

interface ChatPanelProps {
	ydoc: Y.Doc
	provider: HocuspocusProvider | null
	canSend: boolean
	localUser: {
		name: string
		userId: string | null
		guestId: string | null
		profileImageUrl: string | null
	}
	historyRetentionDays: number | 'unlimited' | 'off'
}

interface ChatMessage {
	id: string
	body: string
	createdAt: number
	authorDisplayName: string
	authorUserId: string | null
	authorGuestId: string | null
	authorProfileImageUrl: string | null
}

interface TypingUser {
	key: string
	name: string
}

interface ChatMessageGroup {
	key: string
	authorKey: string
	authorDisplayName: string
	authorUserId: string | null
	authorProfileImageUrl: string | null
	createdAt: number
	messages: ChatMessage[]
}

type ChatRenderItem =
	| {
			type: 'date-separator'
			key: string
			label: string
	  }
	| {
			type: 'message-group'
			key: string
			group: ChatMessageGroup
	  }

const bottomThresholdPx = 20
const maxChatMessageChars = 2000
const typingStateStaleAfterSeconds = 5
const typingClearDelayMs = 1400
const daySeparatorDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
})
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: 'numeric',
	minute: '2-digit',
})

function readField(raw: unknown, key: string): unknown {
	if (!raw || typeof raw !== 'object') {
		return undefined
	}

	if (Object.prototype.hasOwnProperty.call(raw, key)) {
		return (raw as Record<string, unknown>)[key]
	}

	const getter = (raw as { get?: (field: string) => unknown }).get
	if (typeof getter === 'function') {
		return getter(key)
	}

	return undefined
}

function toOptionalString(raw: unknown): string | null {
	if (typeof raw !== 'string') {
		return null
	}
	const trimmed = raw.trim()
	return trimmed.length > 0 ? trimmed : null
}

function toTimestampSeconds(raw: unknown): number | null {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return Math.floor(raw)
	}
	if (typeof raw === 'string') {
		const parsed = Number.parseInt(raw, 10)
		if (Number.isFinite(parsed)) {
			return parsed
		}
	}
	return null
}

function parseChatMessage(raw: unknown, index: number): ChatMessage | null {
	const bodyValue = readField(raw, 'body')
	const body = typeof bodyValue === 'string' ? bodyValue.trim() : ''
	if (body.length === 0) {
		return null
	}

	const id =
		toOptionalString(readField(raw, 'id'))
		?? `message-${index}`
	const createdAt =
		toTimestampSeconds(readField(raw, 'createdAt'))
		?? Math.floor(Date.now() / 1000)

	return {
		id,
		body,
		createdAt,
		authorDisplayName: toOptionalString(readField(raw, 'authorDisplayName')) ?? 'Guest',
		authorUserId: toOptionalString(readField(raw, 'authorUserId')),
		authorGuestId: toOptionalString(readField(raw, 'authorGuestId')),
		authorProfileImageUrl: toOptionalString(readField(raw, 'authorProfileImageUrl')),
	}
}

function identityKeyForMessageAuthor(message: ChatMessage): string {
	return message.authorUserId ?? message.authorGuestId ?? message.authorDisplayName.toLowerCase()
}

function formatTypingText(users: TypingUser[]): string {
	if (users.length === 0) {
		return ''
	}
	if (users.length === 1) {
		return `${users[0].name} is typing...`
	}
	if (users.length === 2) {
		return `${users[0].name} and ${users[1].name} are typing...`
	}
	return `${users[0].name} and ${users.length - 1} others are typing...`
}

function formatHistoryBeginningText(historyRetentionDays: number | 'unlimited' | 'off'): string {
	if (historyRetentionDays === 'off') {
		return "You're at the beginning (this session only)."
	}

	if (historyRetentionDays === 'unlimited') {
		return "You've reached the beginning."
	}

	return `You're at the beginning (${historyRetentionDays} days max).`
}

function createMessageId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function dayKeyFromTimestamp(createdAt: number): string {
	const date = new Date(createdAt * 1000)
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDaySeparatorLabel(createdAt: number): string {
	const date = new Date(createdAt * 1000)
	const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
	const now = new Date()
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86_400_000)

	if (diffDays === 0) {
		return 'Today'
	}
	if (diffDays === 1) {
		return 'Yesterday'
	}
	if (diffDays === -1) {
		return 'Tomorrow'
	}

	return daySeparatorDateFormatter.format(dateStart)
}

function formatMessageTime(createdAt: number): string {
	return messageTimeFormatter.format(new Date(createdAt * 1000))
}

export function ChatPanel({
	ydoc,
	provider,
	canSend,
	localUser,
	historyRetentionDays,
}: ChatPanelProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [draft, setDraft] = useState('')
	const [searchQuery, setSearchQuery] = useState('')
	const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
	const [unseenCount, setUnseenCount] = useState(0)
	const [isAtBottom, setIsAtBottom] = useState(true)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const typingClearTimerRef = useRef<number | null>(null)
	const previousMessageCountRef = useRef(0)
	const isAtBottomRef = useRef(true)

	const messagesArray = useMemo(() => ydoc.getArray<unknown>('messages'), [ydoc])

	const assessBottomPosition = useCallback((): boolean => {
		const container = scrollContainerRef.current
		if (!container) {
			return true
		}
		return container.scrollTop + container.clientHeight >= container.scrollHeight - bottomThresholdPx
	}, [])

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = scrollContainerRef.current
		if (!container) {
			return
		}
		container.scrollTo({ top: container.scrollHeight, behavior })
		setUnseenCount(0)
		setIsAtBottom(true)
	}, [])

	useEffect(() => {
		const updateMessages = () => {
			const parsed = messagesArray
				.toArray()
				.map((raw, index) => parseChatMessage(raw, index))
				.filter((value): value is ChatMessage => value != null)
			setMessages(parsed)
		}

		updateMessages()
		messagesArray.observe(updateMessages)
		return () => {
			messagesArray.unobserve(updateMessages)
		}
	}, [messagesArray])

	useEffect(() => {
		isAtBottomRef.current = isAtBottom
	}, [isAtBottom])

	useEffect(() => {
		const previousCount = previousMessageCountRef.current
		const nextCount = messages.length

		if (previousCount === 0) {
			previousMessageCountRef.current = nextCount
			if (nextCount > 0) {
				requestAnimationFrame(() => {
					scrollToBottom('auto')
				})
			}
			return
		}

		if (nextCount > previousCount) {
			const added = nextCount - previousCount
			if (isAtBottomRef.current) {
				requestAnimationFrame(() => {
					scrollToBottom('auto')
				})
			} else {
				setUnseenCount((current) => current + added)
			}
		}

		previousMessageCountRef.current = nextCount
	}, [messages.length, scrollToBottom])

	useEffect(() => {
		const awareness = provider?.awareness
		if (!awareness) {
			return
		}

		awareness.setLocalStateField('user', {
			name: localUser.name,
			userId: localUser.userId,
			guestId: localUser.guestId,
			profileImageUrl: localUser.profileImageUrl,
		})

		return () => {
			awareness.setLocalStateField('chatTyping', null)
			awareness.setLocalStateField('user', null)
		}
	}, [localUser.guestId, localUser.name, localUser.profileImageUrl, localUser.userId, provider])

	useEffect(() => {
		const awareness = provider?.awareness
		if (!awareness) {
			setTypingUsers([])
			return
		}

		const updateTypingUsers = () => {
			const now = Math.floor(Date.now() / 1000)
			const localClientId = awareness.clientID
			const nextUsers = new Map<string, TypingUser>()

			awareness.getStates().forEach((state: Record<string, unknown>, clientId: number) => {
				if (clientId === localClientId) {
					return
				}

				const user = state.user as
					| {
							name?: string
							userId?: string
							guestId?: string
						}
					| undefined
				if (!user) {
					return
				}

				const typingRaw = state.chatTyping as
					| {
							at?: number
						}
					| null
					| undefined
				const typingAt =
					typeof typingRaw?.at === 'number'
						? Math.floor(typingRaw.at)
						: null

				if (typingAt == null || now - typingAt > typingStateStaleAfterSeconds) {
					return
				}

				const key = user.userId ?? user.guestId ?? `client:${clientId}`
				if (!nextUsers.has(key)) {
					nextUsers.set(key, {
						key,
						name: user.name?.trim() || 'Guest',
					})
				}
			})

			setTypingUsers(Array.from(nextUsers.values()))
		}

		updateTypingUsers()
		awareness.on('change', updateTypingUsers)

		const timer = window.setInterval(updateTypingUsers, 1000)
		return () => {
			window.clearInterval(timer)
			awareness.off('change', updateTypingUsers)
		}
	}, [provider])

	useEffect(() => {
		const awareness = provider?.awareness
		if (!awareness) {
			return
		}

		if (!canSend) {
			awareness.setLocalStateField('chatTyping', null)
			return
		}

		const trimmed = draft.trim()
		if (trimmed.length === 0) {
			awareness.setLocalStateField('chatTyping', null)
			return
		}

		awareness.setLocalStateField('chatTyping', { at: Math.floor(Date.now() / 1000) })

		if (typingClearTimerRef.current != null) {
			window.clearTimeout(typingClearTimerRef.current)
		}

		typingClearTimerRef.current = window.setTimeout(() => {
			awareness.setLocalStateField('chatTyping', null)
			typingClearTimerRef.current = null
		}, typingClearDelayMs)
	}, [canSend, draft, provider])

	useEffect(() => {
		return () => {
			if (typingClearTimerRef.current != null) {
				window.clearTimeout(typingClearTimerRef.current)
			}
		}
	}, [])

	const normalizedQuery = searchQuery.trim().toLowerCase()
	const visibleMessages = useMemo(() => {
		if (!normalizedQuery) {
			return messages
		}
		return messages.filter((message) => {
			return message.body.toLowerCase().includes(normalizedQuery)
				|| message.authorDisplayName.toLowerCase().includes(normalizedQuery)
		})
	}, [messages, normalizedQuery])

	const renderItems = useMemo<ChatRenderItem[]>(() => {
		const items: ChatRenderItem[] = []
		let lastDayKey: string | null = null
		let currentGroup: ChatMessageGroup | null = null

		for (const message of visibleMessages) {
			const messageDayKey = dayKeyFromTimestamp(message.createdAt)

			if (messageDayKey !== lastDayKey) {
				lastDayKey = messageDayKey
				currentGroup = null
				items.push({
					type: 'date-separator',
					key: `date-${messageDayKey}-${message.id}`,
					label: formatDaySeparatorLabel(message.createdAt),
				})
			}

			const authorKey = identityKeyForMessageAuthor(message)
			if (currentGroup && currentGroup.authorKey === authorKey) {
				currentGroup.messages.push(message)
				continue
			}

			const nextGroup: ChatMessageGroup = {
				key: `group-${message.id}`,
				authorKey,
				authorDisplayName: message.authorDisplayName,
				authorUserId: message.authorUserId,
				authorProfileImageUrl: message.authorProfileImageUrl,
				createdAt: message.createdAt,
				messages: [message],
			}

			items.push({
				type: 'message-group',
				key: nextGroup.key,
				group: nextGroup,
			})
			currentGroup = nextGroup
		}

		return items
	}, [visibleMessages])

	const localIdentityKey = localUser.userId ?? localUser.guestId ?? localUser.name.toLowerCase()

	const submitMessage = useCallback(() => {
		if (!canSend) {
			return
		}

		const body = draft.trim()
		if (!body || body.length > maxChatMessageChars) {
			return
		}

		messagesArray.push([
			{
				id: createMessageId(),
				body,
				createdAt: Math.floor(Date.now() / 1000),
				authorDisplayName: localUser.name,
				authorUserId: localUser.userId,
				authorGuestId: localUser.guestId,
				authorProfileImageUrl: localUser.profileImageUrl,
			},
		])

		setDraft('')
		provider?.awareness?.setLocalStateField('chatTyping', null)
		requestAnimationFrame(() => {
			scrollToBottom('smooth')
		})
	}, [canSend, draft, localUser.guestId, localUser.name, localUser.profileImageUrl, localUser.userId, messagesArray, provider, scrollToBottom])

	const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault()
			submitMessage()
		}
	}

	const handleScroll = useCallback(() => {
		const atBottom = assessBottomPosition()
		setIsAtBottom(atBottom)
		if (atBottom) {
			setUnseenCount(0)
		}
	}, [assessBottomPosition])

	const typingText = formatTypingText(typingUsers)
	const messageCharacterCount = draft.length
	const sendDisabled = !canSend || draft.trim().length === 0 || messageCharacterCount > maxChatMessageChars

	return (
		<div className="flex flex-1 flex-col overflow-hidden bg-cz-surface/30">
			<div className="px-3 pb-2 pt-2">
				<div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-cz-text-muted">Chat</div>
				<div className="relative">
					<Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cz-text-muted" />
					<input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search chat history"
						className="w-full rounded-md border border-cz-border bg-cz-bg py-1.5 pl-8 pr-2 text-xs text-cz-text outline-none focus:border-cz-accent"
					/>
				</div>
			</div>

			<div className="relative min-h-0 flex-1">
				<div
					ref={scrollContainerRef}
					className="h-full overflow-y-auto px-3 pb-3"
					onScroll={handleScroll}
				>
					{visibleMessages.length > 0 && (
						<div className="mb-3 text-center text-[11px] text-cz-text-muted/80">
							{formatHistoryBeginningText(historyRetentionDays)}
						</div>
					)}

					{visibleMessages.length === 0 ? (
						<div className="rounded-md border border-cz-border-subtle bg-cz-bg/60 p-3 text-xs text-cz-text-muted">
							{normalizedQuery ? 'No messages match your search.' : 'No messages yet. Start the conversation.'}
						</div>
					) : (
						<div className="space-y-2">
							{renderItems.map((item) => {
								if (item.type === 'date-separator') {
									return (
										<div key={item.key} className="flex items-center gap-2 py-1 text-[10px] font-medium uppercase tracking-wide text-cz-text-muted/80">
											<div className="h-px flex-1 bg-cz-border-subtle" />
											<span>{item.label}</span>
											<div className="h-px flex-1 bg-cz-border-subtle" />
										</div>
									)
								}

								const { group } = item
								const isOwnMessageGroup = group.authorKey === localIdentityKey
								const avatarTooltip = `${group.authorDisplayName}\n${fmtTime(group.createdAt)}`

								return (
									<div key={item.key} className="flex items-start gap-2">
										<Avatar
											name={group.authorDisplayName}
											imageUrl={group.authorProfileImageUrl}
											isGuest={!group.authorUserId}
											title={avatarTooltip}
											size={24}
										/>
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline gap-2">
												<div className={`truncate text-[11px] font-semibold ${isOwnMessageGroup ? 'text-cz-accent' : 'text-cz-text'}`}>
													{group.authorDisplayName}
												</div>
												<div className="text-[10px] text-cz-text-muted">{formatMessageTime(group.createdAt)}</div>
											</div>
											<div className="mt-0.5 space-y-0.5">
												{group.messages.map((message) => (
													<p key={message.id} className="whitespace-pre-wrap break-words text-xs text-cz-text">
														{message.body}
													</p>
												))}
											</div>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</div>

				{!isAtBottom && unseenCount > 0 && (
					<button
						type="button"
						onClick={() => scrollToBottom('smooth')}
						className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-cz-accent/50 bg-cz-bg px-2.5 py-1 text-[11px] font-medium text-cz-accent shadow"
						aria-label="Jump to newest messages"
					>
						<ArrowDown size={12} />
						{unseenCount} New
					</button>
				)}
			</div>

			<div className="px-3 pb-3 pt-0">
				{typingText && (
					<div className="mb-1 text-[11px] text-cz-text-muted">
						{typingText}
					</div>
				)}

				<div className="w-full overflow-hidden rounded-lg border border-cz-border bg-cz-bg">
					<textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value.slice(0, maxChatMessageChars))}
						onKeyDown={handleComposerKeyDown}
						onBlur={() => provider?.awareness?.setLocalStateField('chatTyping', null)}
						placeholder={canSend ? 'Write a message...' : 'Chat is read-only for your role.'}
						disabled={!canSend}
						maxLength={maxChatMessageChars}
						rows={5}
						className="block w-full resize-none border-0 bg-transparent px-3 py-2.5 text-xs text-cz-text outline-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					/>
					<div className="flex items-center justify-between px-2 py-1.5">
						<div className="text-[11px] text-cz-text-muted/80 tabular-nums">
							{messageCharacterCount} / {maxChatMessageChars}
						</div>
						<button
							type="button"
							onClick={submitMessage}
							disabled={sendDisabled}
							className="inline-flex h-8 items-center gap-1 rounded-md border border-cz-border bg-cz-bg px-2.5 text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:cursor-not-allowed disabled:opacity-60"
							aria-label="Send message"
							title="Send"
						>
							<Send size={13} />
							<span className="text-xs font-medium">Send</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
