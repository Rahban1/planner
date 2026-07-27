### Problem
Clicking the done checkbox on a subtask inside the **TaskModal** does not smoothly toggle the subtask between done and undone. The UI appears unresponsive because the checkbox visual state never updates after the click.

**Root cause**: The `TaskModal` fetches the parent task via `useTask(taskId)`, which returns the task with its `subtasks` array. When a subtask is marked done or undone, the mutation hooks (`useCompleteTaskMutation`, `useUncompleteTaskMutation`, `useUpdateTaskMutation`) invalidate `projectSummary` and `priority` queries, but they **do not invalidate the parent task query** (`qk.task(parentId)`). Because the modal's data source is never refreshed, `SubtaskRow` continues to receive the stale `subtask` prop, so `isDone = subtask.status === 'done'` never changes and the checkbox stays in its original state.

**Secondary issue**: `SubtaskRow` uses `useCompleteTaskMutation` for marking done but `useUpdateTaskMutation` for marking undone. This is inconsistent with the dedicated `useUncompleteTaskMutation` hook that already exists.

### Approach
1. **Fix cache invalidation in mutation hooks** (`src/lib/queries.ts`): Updated `onSuccess` in `useCompleteTaskMutation`, `useUncompleteTaskMutation`, and `useUpdateTaskMutation` so that when the mutated task has a `parentId`, the parent task query is also invalidated. This causes `TaskModal`'s `useTask(taskId)` to refetch and supply fresh `subtasks` to `SubtaskRow`.

2. **Use consistent mutation hook in `SubtaskRow`** (`src/components/TaskModal.tsx`): Replaced `useUpdateTaskMutation` with `useUncompleteTaskMutation` in `SubtaskRow` so both done and undone paths use their dedicated hooks. Updated the uncomplete calls to pass `{ data: { id: subtask.id } }` instead of `{ data: { id: subtask.id, status: 'todo' } }`, matching the hook's validator.

3. **Add CSS transition for subtask text color** (`src/styles.css`): Added `transition: color 150ms` to `.subtask-row .st-input` to make the visual toggle feel smoother.

### Is this the best way?
Yes. Invalidating the parent task query is the simplest and most reliable approach. It matches the existing codebase pattern (all mutations use invalidation) and ensures the `TaskModal` always receives fresh data. The D1/local SQLite round-trip is fast enough for a smooth feel.

### Alternatives considered
**Alternative A: Optimistic UI update**
Instead of invalidating the parent query, we could optimistically patch the parent task's cached `subtasks` array in the mutation's `onMutate`. This would be instant but requires manually traversing and updating nested arrays in the TanStack Query cache, which is more complex and error-prone. Invalidation is simpler and safer.

**Alternative B: Lift subtask state up**
We could manage subtask done state in a React context or local state inside `TaskModal` and sync to the server in the background. This would add significant architectural complexity and duplicate state sources, violating the single-source-of-truth principle already established in the app.

### Best tool for the job
**TanStack Query invalidation** — the app already uses TanStack Query for server state, and `invalidateQueries` is the idiomatic way to refresh dependent data. It deduplicates concurrent requests automatically and is safe even when the target query is not in cache.

### Testing
- Verified the changes compile without errors.
- The fix ensures that when a subtask is marked done/undone, the parent task query is invalidated, causing `TaskModal` to refetch and re-render `SubtaskRow` with the updated `status`.
- The `parentId` guard (`if (task.parentId)`) ensures top-level tasks are unaffected.
- `useUncompleteTaskMutation` already sets `status: 'todo'` internally, so passing only `{ id }` is correct.