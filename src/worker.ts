import handler from '@tanstack/react-start/server-entry'

export { TaskChatRoom } from './server/task-chat-room'

export default {
  fetch: handler.fetch,
}
